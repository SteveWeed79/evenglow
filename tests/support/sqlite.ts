import { DatabaseSync } from 'node:sqlite';
import type { SqlDriver, SqlValue } from '@steading/app/db/driver';

/**
 * A `SqlDriver` over `node:sqlite`, for tests.
 *
 * Test infrastructure rather than app code, and deliberately so: the device
 * driver wraps `@capacitor-community/sqlite` and cannot run here. What this
 * buys is that the LocalStore logic — sequence monotonicity, atomic enqueue,
 * quarantine, the migration ladder — is exercised on every commit against real
 * SQLite semantics, instead of only on a handset.
 *
 * What it does NOT prove is durability. `node:sqlite` in this process is not
 * an Android app sandbox surviving a force-stop, and D9 changed exactly those
 * characteristics. That claim belongs to the on-device gate (S6) and cannot be
 * borrowed from here.
 */

export function nodeSqlDriver(filename = ':memory:'): SqlDriver {
  const db = new DatabaseSync(filename);

  // Foreign keys off by default in SQLite; nothing here uses them yet, but a
  // future table that does should not silently lose its constraint.
  db.exec('PRAGMA foreign_keys = ON');

  /**
   * Transactions run one at a time, chained off this promise.
   *
   * A SQLite connection holds one transaction, so two overlapping calls would
   * share it — each able to roll back the other's writes. The first version of
   * this driver tried to nest them with savepoints and the concurrency test
   * caught it unwinding into "no such savepoint", which is the polite version
   * of the failure; the impolite version is a committed half-enqueue.
   */
  let tail: Promise<unknown> = Promise.resolve();
  let inTransaction = false;

  return {
    async run(sql, params = []) {
      db.prepare(sql).run(...(params as SqlValue[]));
    },

    async all<T>(sql: string, params: readonly SqlValue[] = []) {
      return db.prepare(sql).all(...(params as SqlValue[])) as T[];
    },

    async get<T>(sql: string, params: readonly SqlValue[] = []) {
      return db.prepare(sql).get(...(params as SqlValue[])) as T | undefined;
    },

    async transaction<T>(work: () => Promise<T>): Promise<T> {
      // Refused rather than deadlocked. Serialising means a nested call would
      // wait on the transaction it is already inside, and a hang is far harder
      // to diagnose than a thrown error naming the rule.
      if (inTransaction) {
        throw new Error('Nested transactions are not supported; see SqlDriver.transaction.');
      }

      const run = async (): Promise<T> => {
        db.exec('BEGIN');
        inTransaction = true;
        try {
          const result = await work();
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        } finally {
          inTransaction = false;
        }
      };

      // Chain off the tail whether or not the previous call succeeded — one
      // caller's rollback must not strand everyone queued behind it.
      const queued = tail.then(run, run);
      tail = queued.catch(() => undefined);
      return queued;
    },

    async close() {
      db.close();
    },
  };
}
