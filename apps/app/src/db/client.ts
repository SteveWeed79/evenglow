import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import { isDiskFull, type SqlDriver, type SqlTx, type SqlValue, StorageFullError } from './driver';

/**
 * The only file in the app that imports the SQLite plugin.
 *
 * Everything above this line talks to `SqlDriver`. That is what lets the
 * conformance suite run the real store against `node:sqlite` in CI while the
 * device runs the same store against the plugin — same SQL, same store code,
 * two connections.
 */

export const DB_NAME = 'steading';

/**
 * WAL for concurrent reads, but `synchronous = FULL` rather than the usual
 * NORMAL.
 *
 * NORMAL only fsyncs at checkpoints, so an Android force-stop or a battery
 * pull can lose transactions that already returned success. For a log-then-
 * flush app that is data loss with a confirmation tick next to it, and the
 * Phase 2 restart gate tests exactly this. FULL costs an fsync per commit;
 * a farmer taps a tally a few dozen times a day.
 */
const PRAGMAS = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`;

let connection: SQLiteDBConnection | null = null;
let sqlite: SQLiteConnection | null = null;
let webStoreReady = false;

/** jeep-sqlite backs the browser dev loop only; it never ships in the APK. */
async function ensureWebStore(instance: SQLiteConnection): Promise<void> {
  if (webStoreReady || Capacitor.getPlatform() !== 'web') return;
  await instance.initWebStore();
  webStoreReady = true;
}

function rethrow(error: unknown): never {
  if (isDiskFull(error)) throw new StorageFullError();
  throw error;
}

interface QueryShape {
  values?: unknown[];
}

function rows<T>(result: QueryShape): T[] {
  return (result.values ?? []) as T[];
}

class CapacitorDriver implements SqlDriver {
  #db: SQLiteDBConnection;
  /**
   * SQLite has no nested transactions, so a second BEGIN would either error or
   * — worse, with a driver that swallows it — let the inner commit close the
   * outer one early. Refusing outright keeps invariant 5 checkable.
   */
  #inTransaction = false;

  constructor(db: SQLiteDBConnection) {
    this.#db = db;
  }

  async execute(sql: string): Promise<void> {
    try {
      await this.#db.execute(sql, false);
    } catch (error) {
      rethrow(error);
    }
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    try {
      await this.#db.run(sql, [...params], false);
    } catch (error) {
      rethrow(error);
    }
  }

  async query<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    try {
      return rows<T>(await this.#db.query(sql, [...params]));
    } catch (error) {
      rethrow(error);
    }
  }

  async transaction<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
    if (this.#inTransaction) {
      throw new Error('Nested transaction: the caller already holds one.');
    }

    this.#inTransaction = true;
    await this.#db.beginTransaction();

    try {
      const result = await fn(this);
      await this.#db.commitTransaction();
      return result;
    } catch (error) {
      // Rollback failures are secondary — surface the original cause, since
      // that is what the caller can act on.
      await this.#db.rollbackTransaction().catch(() => undefined);
      return rethrow(error);
    } finally {
      this.#inTransaction = false;
    }
  }

  async close(): Promise<void> {
    await this.#db.close();
  }
}

/**
 * Opens (or returns) the single device connection.
 *
 * One connection per process by design: the store serialises its own writes,
 * and a second connection would introduce SQLITE_BUSY contention for no gain
 * in a single-WebView app.
 */
export async function openDriver(): Promise<SqlDriver> {
  if (connection) return new CapacitorDriver(connection);

  sqlite ??= new SQLiteConnection(CapacitorSQLite);
  await ensureWebStore(sqlite);

  // A connection can survive a hot reload while our module state does not.
  const existing = await sqlite.isConnection(DB_NAME, false);
  connection = existing.result
    ? await sqlite.retrieveConnection(DB_NAME, false)
    : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);

  await connection.open();

  const driver = new CapacitorDriver(connection);
  await driver.execute(PRAGMAS);
  return driver;
}

export async function closeDriver(): Promise<void> {
  if (!connection || !sqlite) return;
  await connection.close();
  await sqlite.closeConnection(DB_NAME, false);
  connection = null;
}

/**
 * Flushes the browser dev-loop database to its backing store.
 *
 * A no-op on device, where every commit is already durable. In the browser the
 * plugin holds the database in memory until this is called, so skipping it
 * loses everything on reload — which would make the dev loop lie about exactly
 * the property the app exists to guarantee.
 */
export async function persistWebStore(): Promise<void> {
  if (Capacitor.getPlatform() !== 'web' || !sqlite) return;
  await CapacitorSQLite.saveToStore({ database: DB_NAME });
}
