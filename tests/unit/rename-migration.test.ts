import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What the live-box rename does to `/etc/<name>/api.env`.
 *
 * check:names-ok-file — the fixtures here are old-shaped on purpose. A test
 * for a migration off a name cannot avoid writing that name down.
 *
 * The migration stops the API, moves three directories, renames a service
 * account and copies a database — all of which are visible if they go wrong.
 * This one step is not. It edits the file that holds the server's only database
 * credential, in place, on a box that is down, and the failure mode is an API
 * that comes back up reading an **empty database**: `databaseName()` falls back
 * to the code default when `MONGODB_DB` is absent, so a rewrite that drops the
 * line does not error — it silently points a farm at nothing, and the farm's
 * records are still sitting in the old database nobody is reading.
 *
 * So the assertions here run the **actual `sed` out of the script** rather than
 * restating it, lifted by its own comment heading. A test that restates a shell
 * one-liner is a second copy of whatever is wrong with the first.
 */

const REPO = join(__dirname, '..', '..');
const SCRIPT = join(REPO, 'scripts', 'deploy', 'rename-to-homefarm.sh');

/**
 * Lifts the rewrite out of the script and runs it over one fixture file.
 *
 * `OLD_DB` is what the script discovered on the box; `NEW` is the new name. The
 * `sed -i` and the `grep` guard after it are taken verbatim — only the loop and
 * the `do_it`/`note` reporting around them are dropped, because those need a
 * real `/etc`.
 */
function rewrite(env: string, oldDb: string): string {
  const block = execFileSync(
    'sed',
    ['-n', '/STEADING_\\* -> HOMEFARM_\\*/,/^      "\\$f"$/p', SCRIPT],
    { encoding: 'utf8' },
  );
  expect(block).toContain('sed -i');
  expect(block).toContain('MONGODB_DB');

  const dir = mkdtempSync(join(tmpdir(), 'rename-'));
  const file = join(dir, 'api.env');
  writeFileSync(file, env);

  execFileSync(
    'bash',
    [
      '-c',
      `set -euo pipefail
       NEW=homefarm
       OLD_DB=${JSON.stringify(oldDb)}
       f=${JSON.stringify(file)}
${block}
       grep -q '^MONGODB_DB=' "$f" || printf 'MONGODB_DB=%s\\n' "$NEW" >> "$f"`,
    ],
    { encoding: 'utf8' },
  );

  return readFileSync(file, 'utf8');
}

/** The value of one `KEY=` line, or null when the key is not set at all. */
function value(env: string, key: string): string | null {
  const line = env
    .split('\n')
    .filter((l) => l.startsWith(`${key}=`))
    .at(-1);
  return line === undefined ? null : line.slice(key.length + 1);
}

describe('the live-box rename, rewriting api.env', () => {
  const SECRET = 'mongodb://steading:s3cr3t-with-slashes@127.0.0.1:27017/steadingdb?authSource=admin';

  it('points the API at the new database', () => {
    const out = rewrite(`MONGODB_URI=${SECRET}\nMONGODB_DB=steadingdb\nPORT=3001\n`, 'steadingdb');
    expect(value(out, 'MONGODB_DB')).toBe('homefarm');
  });

  /**
   * The case the whole file exists for. A box set up before `MONGODB_DB` was
   * written out has no line to substitute, `sed` matches nothing, and without
   * the `grep` guard the API restarts reading whatever `databaseName()` decides
   * — which after this rename is `homefarm`, an empty database, with every
   * record still in `steadingdb` and no error anywhere.
   */
  it('adds the line when the box never had one', () => {
    const out = rewrite(`MONGODB_URI=${SECRET}\nPORT=3001\n`, 'steadingdb');
    expect(value(out, 'MONGODB_DB')).toBe('homefarm');
  });

  it('replaces an empty one rather than appending a second', () => {
    const out = rewrite(`MONGODB_URI=${SECRET}\nMONGODB_DB=\n`, 'steadingdb');
    expect(out.split('\n').filter((l) => l.startsWith('MONGODB_DB='))).toHaveLength(1);
    expect(value(out, 'MONGODB_DB')).toBe('homefarm');
  });

  /**
   * The credential is the one thing on this file that cannot be regenerated
   * from the repository. A `sed` that touched it — a `/steading/` pattern
   * without the anchors, say — would take the password with it, and the symptom
   * is an authentication failure on a box with no copy of the original.
   */
  it('leaves the password alone, including a password containing the old name', () => {
    const awkward = 'mongodb://steading:steading-STEADING_x@127.0.0.1:27017/steadingdb?authSource=admin';
    const out = rewrite(`MONGODB_URI=${awkward}\nMONGODB_DB=steadingdb\n`, 'steadingdb');
    const uri = value(out, 'MONGODB_URI');
    expect(uri).toContain('steading:steading-STEADING_x@');
    // Only the database at the end of the path moves.
    expect(uri).toContain('/homefarm?authSource=admin');
  });

  it('renames the deploy variables and nothing that merely contains the word', () => {
    const out = rewrite(
      [
        `MONGODB_URI=${SECRET}`,
        'MONGODB_DB=steadingdb',
        'STEADING_BACKUP_BUCKET=s3://backups/steading',
        'HOMESTEADING_UNRELATED=keep',
        '',
      ].join('\n'),
      'steadingdb',
    );
    expect(value(out, 'HOMEFARM_BACKUP_BUCKET')).toBe('s3://backups/steading');
    expect(value(out, 'STEADING_BACKUP_BUCKET')).toBeNull();
    // The rewrite anchors to `^`, so a key that merely ends in the old prefix
    // is left alone — an operator's own variable is not this rename's to move.
    expect(value(out, 'HOMESTEADING_UNRELATED')).toBe('keep');
  });

  it('is safe to run twice', () => {
    const once = rewrite(`MONGODB_URI=${SECRET}\nMONGODB_DB=steadingdb\n`, 'steadingdb');
    const twice = rewrite(once, 'steadingdb');
    expect(twice).toBe(once);
  });
});

describe('the live-box rename, as a script', () => {
  it('changes nothing without --go', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    // The preview exits before the first `systemctl`, `mv` or `usermod`.
    const preview = source.indexOf('if [ "$GO" != 1 ]; then');
    expect(preview).toBeGreaterThan(0);
    // Comments before the exit describe what --go would do; only what runs
    // counts. Reads (`systemctl is-active`, `list-unit-files`) are fine — the
    // report is made of them.
    const before = source
      .slice(0, preview)
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    for (const verb of [
      'systemctl disable',
      'systemctl enable',
      'systemctl daemon-reload',
      'mv "',
      'usermod',
      'groupmod',
      'chown',
      'mongorestore',
      'mongodump',
      'grantRolesToUser',
      'sed -i',
      'rm -f',
    ]) {
      expect({ verb, present: before.includes(verb) }).toEqual({ verb, present: false });
    }
  });

  /**
   * MongoDB has no rename, so this is a copy — and a copy whose source is then
   * dropped is a migration with no way back. Dropping it is left to a person,
   * later, deliberately.
   */
  it('never drops the old database', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    const executable = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(executable).not.toMatch(/dropDatabase\(\)[^']*"/);
    expect(executable).not.toContain('mongosh "$MONGO_URI" --eval');
  });
});
