import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import type { SqlDriver, SqlValue } from './driver';

/**
 * The device `SqlDriver` — `@capacitor-community/sqlite` (D9).
 *
 * The ONLY file permitted to import the sqlite plugin, the same way
 * `apps/api/src/db/client.ts` is the only file permitted to import
 * MongoClient. Everything above talks to `SqlDriver`, which is why the whole
 * store could be written and proved against `node:sqlite` before a handset
 * was involved.
 *
 * Semantics here are deliberately identical to `tests/support/sqlite.ts`,
 * statement for statement. The two drivers are held to one suite, and any
 * behaviour that differs between them is a difference the suite cannot see —
 * which makes it exactly the kind of thing that surfaces on a device, at
 * 6am, with a morning's egg counts in the queue.
 */

const DATABASE = 'steading';
const SCHEMA_VERSION = 1;

/**
 * `false` — no encryption yet, matching capacitor.config.ts.
 *
 * Turning it on is a one-line change here and a migration for anyone with an
 * existing database, so it waits until the exit gate has been earned without
 * it. A failed gate with two candidate causes is not a diagnosis.
 */
const ENCRYPTED = false;
const MODE = 'no-encryption';
const READONLY = false;

export interface CapacitorSqlDriverOptions {
  /** Overridden by tests and by the throwaway database the gate runs against. */
  database?: string;
}

export async function openCapacitorSqlDriver(
  options: CapacitorSqlDriverOptions = {},
): Promise<SqlDriver> {
  const name = options.database ?? DATABASE;
  const sqlite = new SQLiteConnection(CapacitorSQLite);

  /**
   * A connection can outlive the WebView that created it.
   *
   * Android keeps the plugin alive across a WebView reload, so after a Fast
   * Refresh — or a resume that reloaded the page — `createConnection` throws
   * because the name is already taken. Retrieving the existing one is the
   * documented recovery, and getting this wrong means the app appears to work
   * until the first reload and then cannot open its database at all.
   */
  const existing = (await sqlite.isConnection(name, READONLY)).result === true;
  const db: SQLiteDBConnection = existing
    ? await sqlite.retrieveConnection(name, READONLY)
    : await sqlite.createConnection(name, ENCRYPTED, MODE, SCHEMA_VERSION, READONLY);

  if (!(await db.isDBOpen()).result) await db.open();

  // Matching the test driver: nothing uses foreign keys yet, but a later table
  // that does should not silently lose its constraint on one backing only.
  await db.execute('PRAGMA foreign_keys = ON;', false);

  /**
   * Write-ahead logging.
   *
   * Not in the test driver because `node:sqlite` in a process that is about to
   * exit cleanly cannot show the difference. Here it is the difference: WAL is
   * what keeps a committed transaction committed when Android force-stops the
   * process, which is the entire claim the Phase 2 gate exists to test.
   */
  await db.execute('PRAGMA journal_mode = WAL;', false);
  await db.execute('PRAGMA synchronous = FULL;', false);

  /**
   * Transactions run one at a time, chained off this promise. See
   * SqlDriver.transaction — a SQLite connection holds one transaction, so two
   * overlapping calls would share it, each able to roll back the other's
   * writes. Two taps on the Tally is enough to reach that.
   */
  let tail: Promise<unknown> = Promise.resolve();
  let inTransaction = false;

  /**
   * Every call passes `transaction: false`.
   *
   * The plugin wraps `run` and `execute` in their own transaction by default.
   * Left on, each statement inside our BEGIN would try to open a nested one,
   * and invariant 5 — the outbox row and the projection write committing as a
   * unit — would quietly stop being true.
   */
  const NO_IMPLICIT_TRANSACTION = false;

  return {
    async run(sql, params = []) {
      await db.run(sql, params as SqlValue[], NO_IMPLICIT_TRANSACTION);
    },

    async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
      const result = await db.query(sql, params as SqlValue[]);
      // Same unchecked shape as the test driver, on purpose: callers in
      // db/ own the row types, and having one driver validate while the
      // other does not is how the two stop being interchangeable.
      return (result.values ?? []) as T[];
    },

    async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> {
      const result = await db.query(sql, params as SqlValue[]);
      return (result.values ?? [])[0] as T | undefined;
    },

    async transaction<T>(work: () => Promise<T>): Promise<T> {
      if (inTransaction) {
        throw new Error('Nested transactions are not supported; see SqlDriver.transaction.');
      }

      const run = async (): Promise<T> => {
        await db.execute('BEGIN;', NO_IMPLICIT_TRANSACTION);
        inTransaction = true;
        try {
          const result = await work();
          await db.execute('COMMIT;', NO_IMPLICIT_TRANSACTION);
          return result;
        } catch (error) {
          await db.execute('ROLLBACK;', NO_IMPLICIT_TRANSACTION);
          throw error;
        } finally {
          inTransaction = false;
        }
      };

      // Chained whether or not the previous call succeeded — one caller's
      // rollback must not strand everyone queued behind it.
      const queued = tail.then(run, run);
      tail = queued.catch(() => undefined);
      return queued;
    },

    async close() {
      await db.close();
      await sqlite.closeConnection(name, READONLY);
    },
  };
}
