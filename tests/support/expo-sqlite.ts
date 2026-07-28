import { DatabaseSync } from 'node:sqlite';
import type { SqlValue } from '@steading/app/db/driver';
import type { SqliteConnection } from '@steading/mobile/db/expo-driver';

/**
 * A stand-in for `expo-sqlite`'s database, over `node:sqlite`.
 *
 * `expo-sqlite` is a native module — importing it in Node throws — so without
 * this the Expo driver could only ever be exercised on a handset, which is
 * precisely how the Capacitor driver shipped two bugs that no test could see.
 *
 * The fake is faithful about the one behaviour that matters and is otherwise
 * as thin as possible:
 *
 * **A statement sent to the outer connection during a transaction fails.**
 * That is real: `withExclusiveTransactionAsync` runs on a SECOND connection
 * holding the write lock, so anything sent to the original contends with it
 * rather than joining it, and SQLite reports `database is locked`. It is also
 * the single mistake a driver is most likely to make, because the code reads
 * perfectly and works fine until two writes land in the same transaction.
 *
 * Everything above the driver — the store, the engine, the suites — sees only
 * `SqlDriver`, so running the whole LocalStore suite through here is a real
 * test of the new driver and not a test of this file.
 */
export function fakeExpoConnection(filename = ':memory:'): SqliteConnection {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON');

  let locked = false;

  const guard = (): void => {
    if (locked) {
      // The message SQLite itself uses, so a driver bug reads the same here as
      // it would in logcat.
      throw new Error('database is locked');
    }
  };

  /** The handle inside a transaction. Same connection, minus the lock check. */
  const unlocked: SqliteConnection = {
    async runAsync(sql, params) {
      db.prepare(sql).run(...(params as SqlValue[]));
      return undefined;
    },
    async getAllAsync<T>(sql: string, params: SqlValue[]) {
      return db.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, params: SqlValue[]) {
      return (db.prepare(sql).get(...params) ?? null) as T | null;
    },
    async execAsync(sql) {
      db.exec(sql);
    },
    async withExclusiveTransactionAsync() {
      // Real `Transaction` extends the database type, so nesting type-checks
      // and then deadlocks. The driver refuses it a level up; if that ever
      // regresses, this is where it gets caught rather than hanging the suite.
      throw new Error('nested transaction on the transaction connection');
    },
    async closeAsync() {
      // A no-op, matching the real Transaction: the outer connection stays
      // open and `withExclusiveTransactionAsync` closes the inner one itself.
    },
  };

  return {
    async runAsync(sql, params) {
      guard();
      return unlocked.runAsync(sql, params);
    },
    async getAllAsync<T>(sql: string, params: SqlValue[]) {
      guard();
      return unlocked.getAllAsync<T>(sql, params);
    },
    async getFirstAsync<T>(sql: string, params: SqlValue[]) {
      guard();
      return unlocked.getFirstAsync<T>(sql, params);
    },
    async execAsync(sql) {
      guard();
      return unlocked.execAsync(sql);
    },

    /**
     * Commits or rolls back as one unit, exactly as the real one does — see
     * expo-sqlite's SQLiteDatabase.withExclusiveTransactionAsync, which BEGINs,
     * runs the task, COMMITs, and ROLLBACKs on any throw before rethrowing.
     */
    async withExclusiveTransactionAsync(task) {
      guard();
      locked = true;
      try {
        db.exec('BEGIN');
        try {
          await task(unlocked);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      } finally {
        locked = false;
      }
    },

    async closeAsync() {
      db.close();
    },
  };
}
