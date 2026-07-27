import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { useDriver } from '../../apps/app/src/db/open';
import { closeDb, store } from '../../apps/app/src/db/open';
import { isDiskFull, type SqlDriver, type SqlTx, type SqlValue, StorageFullError } from '../../apps/app/src/db/driver';

/**
 * `node:sqlite` behind the same `SqlDriver` the Capacitor plugin implements.
 *
 * This is what lets the conformance suite exercise the REAL store — the same
 * SQL, the same transactions, the same migration ladder — in CI, on a machine
 * with no phone attached. A hand-written fake store would test the fake.
 *
 * It is not a substitute for running on hardware. WAL behaviour under an
 * Android force-stop is the one property this cannot check, which is why the
 * device gate stays in the plan.
 */

class NodeSqliteDriver implements SqlDriver {
  #db: DatabaseSync;
  #inTransaction = false;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  async execute(sql: string): Promise<void> {
    try {
      this.#db.exec(sql);
    } catch (error) {
      throw isDiskFull(error) ? new StorageFullError() : error;
    }
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    try {
      this.#db.prepare(sql).run(...params);
    } catch (error) {
      throw isDiskFull(error) ? new StorageFullError() : error;
    }
  }

  async query<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    try {
      return this.#db.prepare(sql).all(...params) as T[];
    } catch (error) {
      throw isDiskFull(error) ? new StorageFullError() : error;
    }
  }

  async transaction<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
    if (this.#inTransaction) {
      throw new Error('Nested transaction: the caller already holds one.');
    }

    this.#inTransaction = true;
    this.#db.exec('BEGIN');

    try {
      const result = await fn(this);
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw isDiskFull(error) ? new StorageFullError() : error;
    } finally {
      this.#inTransaction = false;
    }
  }

  async close(): Promise<void> {
    this.#db.close();
  }
}

let directory: string | null = null;
let path: string | null = null;

function openFile(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  // Same pragmas the device uses. `synchronous = FULL` matters here too: a test
  // that passed under NORMAL would not prove the property the device needs.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/**
 * A brand-new database on disk, wired into `open.ts`.
 *
 * On disk rather than `:memory:` deliberately — `simulateRestart` has to be
 * able to drop every handle and reopen the same bytes, which is the whole
 * point of the restart-survival assertions.
 */
export async function freshDb(): Promise<void> {
  await closeDb().catch(() => undefined);

  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = mkdtempSync(join(tmpdir(), 'steading-'));
  path = join(directory, 'steading.db');

  useDriver(async () => new NodeSqliteDriver(openFile(path as string)));
  await store();
}

/**
 * Drops every in-process handle and reopens the same file — process death,
 * as far as the store can tell.
 */
export async function simulateRestart(): Promise<void> {
  if (!path) throw new Error('Call freshDb() first.');
  await closeDb();
  useDriver(async () => new NodeSqliteDriver(openFile(path as string)));
  await store();
}

/** Raw access, for tests that must corrupt storage to prove a defence works. */
export async function raw<T>(fn: (db: DatabaseSync) => T): Promise<T> {
  if (!path) throw new Error('Call freshDb() first.');
  const db = openFile(path);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function cleanup(): void {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = null;
  path = null;
}
