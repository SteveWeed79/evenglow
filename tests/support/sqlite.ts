import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { SqlDriver, SqlOps, SqlValue } from '@steading/core/db/driver';
import { createGate } from '@steading/core/db/gate';

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
   * One lane for every operation, transactions included.
   *
   * This driver used to serialise transactions alone, and to refuse nesting by
   * sampling an `inTransaction` flag. Both halves were wrong in the same way
   * the Expo driver's were, and for the same reason: a flag read at call time
   * cannot tell a nested call from a concurrent one, so a second genuine
   * transaction arriving while the first was mid-body was refused and its
   * mutation lost. `node:sqlite` is synchronous, which hid it here and did not
   * hide it on a handset. Nesting is now refused structurally — the handle
   * passed to the body is the only thing in scope, and its `transaction`
   * throws.
   */
  const gate = createGate();

  const ops = (transaction: SqlOps['transaction']): SqlOps => ({
    async run(sql, params = []) {
      db.prepare(sql).run(...(params as SqlValue[]));
    },

    async all<T>(sql: string, params: readonly SqlValue[] = []) {
      return db.prepare(sql).all(...(params as SqlValue[])) as T[];
    },

    async get<T>(sql: string, params: readonly SqlValue[] = []) {
      return db.prepare(sql).get(...(params as SqlValue[])) as T | undefined;
    },

    transaction,
  });

  const refuseNesting = <T,>(): Promise<T> =>
    Promise.reject(new Error('Nested transactions are not supported; see SqlOps.transaction.'));

  const driver: SqlDriver = {
    run: (sql, params = []) => gate.enter(() => ops(driver.transaction).run(sql, params)),

    all: <T,>(sql: string, params: readonly SqlValue[] = []) =>
      gate.enter(() => ops(driver.transaction).all<T>(sql, params)),

    get: <T,>(sql: string, params: readonly SqlValue[] = []) =>
      gate.enter(() => ops(driver.transaction).get<T>(sql, params)),

    transaction: <T,>(work: (tx: SqlOps) => Promise<T>): Promise<T> =>
      gate.enter(async (beat) => {
        db.exec('BEGIN');
        try {
          // `node:sqlite` is one connection with no separate transaction
          // handle, so the body's handle differs only in refusing to nest.
          // That is enough: the lane guarantees nothing else runs meanwhile.
          const inside = ops(refuseNesting);
          const result = await work({
            run: async (sql, params) => {
              beat();
              return inside.run(sql, params);
            },
            all: async (sql, params) => {
              beat();
              return inside.all(sql, params);
            },
            get: async (sql, params) => {
              beat();
              return inside.get(sql, params);
            },
            transaction: refuseNesting,
          });
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      }, true),

    close: () => gate.enter(async () => db.close()),
  };

  return driver;
}

/**
 * Ids for a store under test, from Node's own crypto.
 *
 * `openSqliteStore` takes no default any more — see the note there. The reason
 * this helper is in the test support rather than in `core` is the whole point:
 * `node:crypto` is a fact about where the tests run, not about the app, and a
 * default living in core is how every suite ended up on a path Hermes cannot
 * execute.
 */
export function nodeIds(): { randomUUID: () => string } {
  return { randomUUID: () => randomUUID() };
}
