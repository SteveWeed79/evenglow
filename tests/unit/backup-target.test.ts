import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { databaseName } from '@homefarm/api/db/client';

/**
 * Which database gets backed up, and whether the result is a backup.
 *
 * ## The two halves came apart, and both said success
 *
 * **`mongodump` was handed the URI and the URI's path decided.** The API's
 * `databaseName()` ignores that path entirely — it reads `MONGODB_DB` and falls
 * back to the literal `homefarm`. So on any box where the two disagree, the
 * nightly backup dumped a database **nothing writes to**, uploaded it, moved the
 * marker, and reported success. `backup.env` is a separate file from `api.env`,
 * edited at a different time by a different step, so the two coming apart is the
 * ordinary case rather than the exotic one.
 *
 * **And the only check on the result was `size >= 4096`**, a constant with no
 * relation to anything. A farm database with photos runs to hundreds of
 * megabytes; a five-kilobyte archive passed, and the likeliest way to produce
 * one was a correct dump of the wrong, empty database. The two defects made
 * each other invisible.
 *
 * ## Driven, not read
 *
 * The URI functions are pure shell and are sourced out of the script and run,
 * so a rewrite that mishandles a password containing a slash fails here. The
 * parts that need a mongod — the dump, the floor, the read-back — are asserted
 * against the source, which is the same trade `deploy-units.test.ts` makes and
 * for the same reason: they only manifest on a live box.
 */

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'backup-mongo.sh');
const source = readFileSync(SCRIPT, 'utf8');

/** Sources the pure helpers out of the script and calls one. */
function shell(fn: string, arg: string, env: Record<string, string> = {}): string {
  const lifted = execFileSync(
    'sed',
    ['-n', '/^resolve_db()/,/^}/p;/^uri_db()/,/^}/p;/^uri_without_db()/,/^}/p', SCRIPT],
    { encoding: 'utf8' },
  );

  return execFileSync('bash', ['-c', `${lifted}\n${fn} "$1"`, '--', arg], {
    encoding: 'utf8',
    // `MONGODB_DB` blanked first: an ambient one would leak into the case that
    // is about it being unset, which is the case with the interesting answer.
    env: { ...process.env, MONGODB_DB: '', ...env },
  });
}

describe('which database the backup dumps', () => {
  /**
   * Parity with the API, asserted against the API rather than against a copy of
   * its rule. If `databaseName()` ever changes its fallback, this fails.
   */
  it('resolves the name the way the API does', () => {
    expect(shell('resolve_db', '')).toBe(databaseName({}));
    expect(shell('resolve_db', '', { MONGODB_DB: 'steadingdb' })).toBe(
      databaseName({ MONGODB_DB: 'steadingdb' }),
    );
    // Whitespace-only is unset on both sides, which is what a `MONGODB_DB=` line
    // in an env file produces.
    expect(shell('resolve_db', '', { MONGODB_DB: '   ' })).toBe(
      databaseName({ MONGODB_DB: '   ' }),
    );
  });

  /**
   * The path is read only so the script can say the URI does not decide. Its
   * own parsing has to survive a password with a slash in it, which is why the
   * credentials are cut off before the path is looked for.
   */
  it('reads the URI path without being fooled by the credentials', () => {
    expect(shell('uri_db', 'mongodb://u:p@127.0.0.1:27017/steadingdb?authSource=admin')).toBe(
      'steadingdb',
    );
    expect(shell('uri_db', 'mongodb://u:p%2Fass@127.0.0.1:27017/steadingdb')).toBe('steadingdb');
    expect(shell('uri_db', 'mongodb://127.0.0.1:27017/?replicaSet=rs')).toBe('');
    expect(shell('uri_db', 'mongodb://127.0.0.1:27017')).toBe('');
  });

  /**
   * `mongodump` refuses `--db` alongside a URI that already names one, so the
   * path is removed and `--db` becomes the single source. The query string has
   * to survive: it carries `authSource`, without which the connection fails.
   */
  it('strips the database and keeps everything that authenticates', () => {
    expect(shell('uri_without_db', 'mongodb://u:p@127.0.0.1:27017/steadingdb?authSource=admin')).toBe(
      'mongodb://u:p@127.0.0.1:27017/?authSource=admin',
    );
    expect(shell('uri_without_db', 'mongodb+srv://u:p@cluster.example/db?retryWrites=true')).toBe(
      'mongodb+srv://u:p@cluster.example/?retryWrites=true',
    );
    expect(shell('uri_without_db', 'mongodb://127.0.0.1:27017/?replicaSet=rs')).toBe(
      'mongodb://127.0.0.1:27017/?replicaSet=rs',
    );
  });

  it('dumps the resolved name rather than whatever the URI said', () => {
    expect(source).toContain('mongodump --uri="$base" --db="$db_name"');
    // And says so when the two disagree, because the operator almost certainly
    // believes the URI is the one that counts.
    expect(source).toContain('which is the live one');
  });
});

describe('whether what was dumped is a backup', () => {
  /**
   * The finding: a constant with no relation to the source. The floor is
   * derived from what the server says this database holds, so it scales with a
   * farm instead of standing still while the farm grows.
   */
  it('takes its floor from the size of the database', () => {
    expect(source).toContain('stats().dataSize');
    expect(source).toContain('data_size / 50');
    // The constant stays as an independent lower bound rather than as the check.
    expect(source).toContain('ARCHIVE_FLOOR_BYTES');
  });

  /**
   * And reads the archive back. Size says the bytes are there; this says they
   * are an archive, which is what a killed `mongodump` leaves without.
   */
  it('parses the archive before uploading it', () => {
    expect(source).toContain('--dryRun');
    expect(source).toContain('cannot be read back');
    // Guarded on the flag existing: the tools come from an unpinned
    // distribution package, and a verification that fails a good backup is
    // worse than one that is skipped and says so.
    expect(source).toContain("mongorestore --help 2>&1 | grep -q -- '--dryRun'");
    expect(source).toContain('checked by size only');
  });

  /** It is in the same package as `mongodump`, and the backup path now needs it. */
  it('requires mongorestore up front rather than failing at the check', () => {
    const backupBody = source.slice(source.indexOf('backup() {'), source.indexOf('list() {'));
    expect(backupBody).toContain("need mongorestore 'Install the MongoDB Database Tools.'");
  });
});
