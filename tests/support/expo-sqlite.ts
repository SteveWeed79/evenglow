import { DatabaseSync } from 'node:sqlite';
import type { SqlValue } from '@steading/core/db/driver';
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

/**
 * The same fake, plus the native lifecycle that produced the crash.
 *
 * `withExclusiveTransactionAsync` builds a SECOND connection
 * (`Transaction.createAsync` → `new NativeDatabase(path, {useNewConnection:
 * true})`) and closes it in a `finally` without waiting for anything the
 * caller may still have in flight against it. On device, a statement prepared
 * against that connection after it is gone fails inside expo-modules-core's
 * shared-object registry — the "Cannot use shared object that was already
 * released" the emulator reported.
 *
 * Modelled here so the regression is provable in Node. `where` records which
 * connection every statement actually ran on, which is the property under
 * test: a read that has nothing to do with the transaction must never touch
 * the transaction's connection.
 */
export interface TracingConnection extends SqliteConnection {
  /** One entry per statement: `db` or `txn`, and the SQL. */
  readonly where: { on: 'db' | 'txn'; sql: string }[];
}

export function tracingExpoConnection(
  filename = ':memory:',
  /**
   * Milliseconds a statement spends in flight before it touches the
   * connection, modelling the JSI hop onto `Dispatchers.IO` and back. Zero is
   * fine for routing assertions; a non-zero value is what makes "still in
   * flight when the connection was released" reachable at all.
   */
  latencyMs = 0,
): TracingConnection {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON');

  const where: { on: 'db' | 'txn'; sql: string }[] = [];
  let released = false;

  const statements = (on: 'db' | 'txn'): Omit<SqliteConnection, 'withExclusiveTransactionAsync' | 'closeAsync'> => ({
    async runAsync(sql, params) {
      await arrive(on, sql);
      db.prepare(sql).run(...(params as SqlValue[]));
      return undefined;
    },
    async getAllAsync<T>(sql: string, params: SqlValue[]) {
      await arrive(on, sql);
      return db.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, params: SqlValue[]) {
      await arrive(on, sql);
      return (db.prepare(sql).get(...params) ?? null) as T | null;
    },
    async execAsync(sql) {
      await arrive(on, sql);
      db.exec(sql);
    },
  });

  /**
   * The connection is recorded when the statement is ISSUED and checked when
   * it lands, which is the whole shape of the crash: the driver chose the
   * connection at call time, and the native side prepared against it later.
   */
  async function arrive(on: 'db' | 'txn', sql: string): Promise<void> {
    where.push({ on, sql });
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
    if (on === 'txn' && released) {
      // Verbatim from expo-modules-core's SharedObjectRegistry, so a
      // regression reads here the way it reads in logcat.
      throw new Error('Cannot use shared object that was already released');
    }
  }

  const txn: SqliteConnection = {
    ...statements('txn'),
    async withExclusiveTransactionAsync() {
      throw new Error('nested transaction on the transaction connection');
    },
    async closeAsync() {
      // No-op: the outer connection outlives the transaction.
    },
  };

  return {
    where,
    ...statements('db'),

    async withExclusiveTransactionAsync(task) {
      released = false;
      try {
        db.exec('BEGIN');
        try {
          await task(txn);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      } finally {
        // expo closes the transaction's connection here, synchronously with
        // the end of the task and regardless of what is still in flight.
        released = true;
      }
    },

    async closeAsync() {
      db.close();
    },
  };
}
