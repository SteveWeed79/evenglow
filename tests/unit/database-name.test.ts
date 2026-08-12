import { describe, expect, it } from 'vitest';
import { databaseName } from '@steading/api/db/client';
import { readEnv } from '@steading/api/env';

/**
 * Which database the server reads, and the empty string that sent it elsewhere.
 *
 * ## The bug
 *
 * `client.db(process.env.MONGODB_DB ?? 'steading')`. `??` falls back only on
 * null and undefined, so `MONGODB_DB=` — which is what systemd's
 * `EnvironmentFile` produces from a key with nothing after it — arrives as `''`
 * and passes through.
 *
 * **The driver does not reject it.** `client.db('')` returns the connection's
 * default database, which for a URI with no path is `test`. So the server comes
 * up, `/health` is green, every request succeeds, and a farm's records are
 * written to an empty database nobody is reading from. There is no error
 * anywhere in that sequence.
 *
 * Found while pointing the first real deployment at an Atlas cluster whose
 * database is `steadingdb`. Asserted here because the failure is silent, only
 * happens with a particular env file, and looks from a handset exactly like a
 * farm's records having vanished.
 *
 * ## The other half of it
 *
 * The name does **not** come from the connection string. A URI ending
 * `/steadingdb` is connected to and then ignored — `MONGODB_DB` is the only
 * thing that chooses, which is why the deployment template now carries it
 * commented out with the reason attached.
 */

describe('the database the server reads', () => {
  it('defaults when nothing says otherwise', () => {
    expect(databaseName({})).toBe('steading');
    expect(databaseName({ MONGODB_DB: undefined })).toBe('steading');
  });

  it('uses what it is given', () => {
    expect(databaseName({ MONGODB_DB: 'steadingdb' })).toBe('steadingdb');
  });

  /**
   * The line the bug is about. `MONGODB_DB=` in an env file is an empty string,
   * not an absent key, and an empty string reaches the driver as "the
   * connection default" rather than as an error.
   */
  it('treats an empty value as absent rather than as a database', () => {
    expect(databaseName({ MONGODB_DB: '' })).toBe('steading');
    expect(databaseName({ MONGODB_DB: '   ' })).toBe('steading');
  });

  it('does not carry surrounding whitespace into a database name', () => {
    // `MONGODB_DB=steadingdb ` with a trailing space is a plausible edit, and
    // Mongo would happily create a database whose name ends in one.
    expect(databaseName({ MONGODB_DB: ' steadingdb ' })).toBe('steadingdb');
  });

  /**
   * `env.ts` parses this key as well, and the two must not disagree — one of
   * them deciding `steading` while the other decides `test` is the same class
   * of fault seen from the other side.
   */
  it('agrees with the env schema', () => {
    const base = {
      AUTH_SECRET: 'a'.repeat(32),
      MONGODB_URI: 'mongodb://127.0.0.1:27017',
    };

    for (const value of ['', '   ', 'steadingdb', ' steadingdb ']) {
      expect(readEnv({ ...base, MONGODB_DB: value }).MONGODB_DB, JSON.stringify(value)).toBe(
        databaseName({ MONGODB_DB: value }),
      );
    }

    expect(readEnv(base).MONGODB_DB).toBe(databaseName({}));
  });
});
