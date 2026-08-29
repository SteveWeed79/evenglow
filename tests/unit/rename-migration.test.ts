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
function rewrite(env: string, oldDb: string, copyDb: 0 | 1 = 1): string {
  const block = execFileSync(
    'sed',
    ['-n', '/STEADING_\\* -> HOMEFARM_\\*/,/^    fi$/p', SCRIPT],
    { encoding: 'utf8' },
  );
  expect(block).toContain('sed -i');
  expect(block).toContain('MONGODB_DB');
  // The database half is guarded, so the block must carry the guard with it —
  // lifting only the seds would test a shape the script no longer has.
  expect(block).toContain('COPY_DB');

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
       COPY_DB=${copyDb}
       f=${JSON.stringify(file)}
${block}`,
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

  /**
   * `--keep-db`, which is the path every box built by `setup-mongo.sh` has to
   * take: that account holds `readWrite`+`dbAdmin` on one database and cannot
   * grant itself rights on a new one, so the copy can never run and the
   * database keeps its name.
   *
   * The rename of the box still happens; what must NOT happen is the API being
   * pointed at a database nothing created. That is an outage, and it is the one
   * this flag exists to prevent — so both database lines are left exactly as
   * they were while the deploy variables still move.
   */
  it('leaves the database alone with --keep-db, and still renames the rest', () => {
    const out = rewrite(
      [`MONGODB_URI=${SECRET}`, 'MONGODB_DB=steadingdb', 'STEADING_BACKUP_BUCKET=s3://b', ''].join('\n'),
      'steadingdb',
      0,
    );

    expect(value(out, 'MONGODB_DB')).toBe('steadingdb');
    expect(value(out, 'MONGODB_URI')).toBe(SECRET);
    // The half that is safe either way still happens.
    expect(value(out, 'HOMEFARM_BACKUP_BUCKET')).toBe('s3://b');
  });

  /**
   * And it does not invent the line either. A box with no `MONGODB_DB` is
   * relying on the code default; writing one in under `--keep-db` would pin it
   * to a name the operator never chose.
   */
  it('does not add MONGODB_DB with --keep-db', () => {
    const out = rewrite(`MONGODB_URI=${SECRET}\nPORT=3001\n`, 'steadingdb', 0);
    expect(value(out, 'MONGODB_DB')).toBeNull();
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
      // `command -v mongodump` names a destructive verb and runs nothing. The
      // pre-flight checks are made of these, and they have to run before the
      // preview or they are not checks — they are a trap with a description
      // attached. What follows still catches an actual invocation.
      .filter((line) => !line.includes('command -v'))
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
  /**
   * With `--keep-db` there is no second copy, so `$OLD_DB` is not a spare left
   * behind for rollback — it is the database the API was just started against.
   *
   * The closing text used to print the drop unconditionally, which meant the
   * one flag added to keep a box safe ended by handing the operator a command
   * that destroys the farm's only dataset: days later, box healthy, following
   * the script's own advice. Asserted on the source rather than by running it,
   * because reaching that paragraph needs a live box.
   */
  it('only offers to drop a database when it actually made a copy', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    const drop = source.indexOf('dropDatabase()');
    expect(drop).toBeGreaterThan(0);

    // Everything above the drop, with comments stripped: the nearest preceding
    // guard has to be the one that knows a copy happened.
    const above = source
      .slice(0, drop)
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');

    const guard = above.lastIndexOf('if [ "$COPY_DB" = 1 ]');
    const closed = above.lastIndexOf('\nfi');
    expect(guard).toBeGreaterThan(0);
    // The guard opens after the last one closed, so the drop is inside it.
    expect(guard).toBeGreaterThan(closed);
  });

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

/**
 * The half-states, which are the shape every defect in this script has taken.
 *
 * The rename is not one operation. It moves trees, renames an account, copies a
 * database, rewrites an environment file and replaces eight units — and the
 * question that decides whether a failure is recoverable is always the same:
 * **is the box, at that instant, still describing the world it is actually
 * in?** These are the three places where it was not, asserted against the
 * source because they need a live box, a first failure and a second run.
 */
describe('what a failure halfway leaves behind', () => {
  const source = readFileSync(SCRIPT, 'utf8');

  /**
   * D5. Step 5 rewrote `MONGODB_DB=homefarm` and step 6 then made the database.
   * A failed copy left the env file saying `homefarm`, so the next run read
   * `OLD_DB` back as `homefarm`, said "database is already 'homefarm'", set
   * `COPY_DB=0` and **skipped the copy entirely** — pointing the API at a
   * database that was never made.
   */
  it('copies the database before it points anything at it', () => {
    const copy = source.indexOf('# ── 5. the database, BEFORE anything is pointed at it');
    const rewrite = source.indexOf('# ── 6. the environment files');

    expect(copy).toBeGreaterThan(0);
    expect(rewrite).toBeGreaterThan(copy);
  });

  /**
   * And the backup of the file it rewrites is never replaced. It holds the only
   * on-box record of the old database name and of the Mongo password; a second
   * run overwriting it makes the thing kept for recovery a copy of the thing it
   * was meant to recover from.
   */
  it('never overwrites a .pre-rename that is already there', () => {
    expect(source).toContain('if [ -e "$f.pre-rename" ]; then');
    expect(source).toContain('it is from before the first run');
  });

  /**
   * D6. The fallback was `steadingdb`, a name the code has never used —
   * `databaseName()` returns `steading` before the rename commit and `homefarm`
   * after, and the `db` suffix is one box's convention. A wrong guess dumps a
   * database that does not exist, restores nothing, and reports success.
   */
  it('asks rather than guessing which database the API reads', () => {
    expect(source).not.toContain('OLD_DB="${OLD}db"');
    expect(source).toContain('does not set MONGODB_DB, so this script cannot tell which database');
  });

  /**
   * D7. `getCollectionNames()` on an empty source returns `[]`, so `TALLY` was
   * empty, the verification loop never ran once, and a copy that moved nothing
   * reported verified. It covered for D6 exactly: a wrong name produces an
   * empty source.
   */
  it('refuses a copy that moved nothing rather than verifying it', () => {
    expect(source).toContain('has no collections, so there is nothing to copy');
    // And a second guard on the loop itself, in case the tally's shape changes.
    expect(source).toContain('Read no collection counts out of the tally');
  });

  /**
   * D8. Every old unit was removed first and the checkout was asked for
   * replacements afterwards, so a tree without them left the box with no API
   * unit at all — after the database had been copied and the trees moved, and
   * with the deploy unit that would have fixed it among the ones just deleted.
   */
  it('checks the new units exist before removing the old ones', () => {
    const check = source.indexOf('is not in the checkout, so removing');
    const removal = source.indexOf('do_it rm -f "/etc/systemd/system/$u"');

    expect(check).toBeGreaterThan(0);
    expect(removal).toBeGreaterThan(check);
  });
});

/**
 * The one that cannot be undone.
 *
 * `migrate-to-local-mongo.sh` restores with `--drop`, which is right while the
 * migration has not landed: a re-run after a failed restore has to replace
 * rather than merge, because merging skips every `_id` collision silently and
 * looks like success.
 *
 * **After cutover it is the opposite.** The local database is then the farm's
 * only copy of everything logged since: phones flush to it, the server answers
 * `applied`, and the clients never resend those mutations (invariant 7). Atlas
 * has none of it either, because nothing has written to Atlas since the URI
 * changed. So a re-run does not lose a few hours of work — it loses them for
 * good.
 */
describe('restoring onto a box that is already live', () => {
  const source = readFileSync(
    join(REPO, 'scripts', 'deploy', 'migrate-to-local-mongo.sh'),
    'utf8',
  );

  it('reads the URI the API is actually configured with', () => {
    expect(source).toContain('API_ENV=/etc/homefarm/api.env');
    expect(source).toContain('*127.0.0.1*|*localhost*)');
  });

  /** And stops there, before the drop rather than after it. */
  it('refuses before the restore rather than reporting afterwards', () => {
    const check = source.indexOf('the cutover has happened and the local database is the live one');
    const restore = source.indexOf('mongorestore --uri="$LOCAL_URI"');

    expect(check).toBeGreaterThan(0);
    expect(restore).toBeGreaterThan(check);
  });

  /**
   * No escape hatch, deliberately. A `--force` here is a flag whose only use is
   * the accident it would cause, and the recovery it would need does not exist.
   */
  it('offers a verified backup rather than a way past', () => {
    // Executable lines only — the reasoning above the refusal names the flag it
    // declines to add, and a verb in a comment is not an option.
    const code = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');

    expect(code).not.toContain('--force');
    // The script takes no options at all, so there is nothing to pass one to.
    expect(code).not.toContain('for arg in "$@"');
    expect(source).toContain('backup-mongo.sh backup');
  });
});

