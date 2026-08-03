import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
 * ## Two connections, because expo opens two
 *
 * This fake used to be **one** connection with a boolean pretending to be a
 * lock. That was the same class of mistake this whole file exists to catch: the
 * test runtime was more generous than the phone, and every property that
 * depends on there genuinely being two connections was unobservable.
 *
 * `withExclusiveTransactionAsync` opens a SECOND connection to the same file
 * (`Transaction.createAsync` → `new NativeDatabase(path, {useNewConnection:
 * true})`, expo issue #41986) and closes it in a `finally`. So this opens a
 * second `DatabaseSync` on a real file and closes it in a `finally` too, and
 * three things stop being simulated:
 *
 * - **PRAGMAs diverge for real.** `busy_timeout` and `foreign_keys` are
 *   per-connection, so a setting `applyPragmas` made on the handle `open.ts`
 *   opened is simply absent from the connection that performs every write. The
 *   driver's own doc has asserted this for months with nothing able to prove it.
 * - **A lock is a lock.** A write issued on the outer connection while the
 *   transaction holds the file fails with SQLite's own `database is locked`,
 *   raised by SQLite, not by this file.
 * - **Isolation is real.** The outer connection cannot see uncommitted rows,
 *   because it is a different connection rather than the same one wearing a
 *   different name.
 *
 * ## What the boolean got wrong, and why losing it is a gain
 *
 * It threw on **every** statement sent to the outer connection during a
 * transaction, reads included. Under WAL that is not what SQLite does — a
 * reader takes the pre-transaction snapshot and succeeds. The fake was
 * asserting a stricter world than the device's, which is the one direction a
 * fake must never be wrong in.
 *
 * The rule it was standing in for is real, though: the driver must never route
 * a statement from elsewhere onto the transaction's connection, because expo
 * closes that connection the moment the body returns. That rule is enforced
 * where it belongs — `tracingExpoConnection` records which connection every
 * statement ran on — and observed here by `strays`, which counts rather than
 * lies.
 *
 * ## Why a file rather than `:memory:`
 *
 * Two connections to `:memory:` are two separate databases. A shared in-memory
 * database needs URI filenames, which `node:sqlite` does not expose. A file
 * under the OS temp directory is what expo has on device anyway.
 */

/**
 * One temp directory for the whole worker, swept when it exits.
 *
 * Per-fake cleanup is not enough: most tests never call `closeAsync`, and a
 * test that fails mid-transaction never reaches its own teardown.
 */
const scratch = mkdtempSync(join(tmpdir(), 'steading-sqlite-'));
process.once('exit', () => rmSync(scratch, { recursive: true, force: true }));

let files = 0;
const tempFile = (): string => join(scratch, `db-${++files}.sqlite`);

/** Notified as each statement is issued; may stall it, may refuse it. */
type Watch = (on: 'db' | 'txn', sql: string) => Promise<void> | void;

/**
 * Opened the way expo opens one, which is to say with nothing applied.
 *
 * `node:sqlite` turns foreign keys ON by default and stock SQLite does not.
 * Left at Node's default, the transaction connection would enforce constraints
 * here that it silently ignores on a handset — so it is turned off explicitly,
 * and `applyPragmas` turning it on for one connection becomes visible as the
 * per-connection setting it actually is.
 */
function openConnection(file: string): DatabaseSync {
  return new DatabaseSync(file, { enableForeignKeyConstraints: false });
}

/** The four statement methods, bound to one real connection. */
function statementsOn(
  db: DatabaseSync,
  on: 'db' | 'txn',
  watch: Watch,
): Omit<SqliteConnection, 'withExclusiveTransactionAsync' | 'closeAsync'> {
  return {
    async runAsync(sql: string, params: SqlValue[]) {
      await watch(on, sql);
      db.prepare(sql).run(...params);
      return undefined;
    },
    async getAllAsync<T>(sql: string, params: SqlValue[]) {
      await watch(on, sql);
      return db.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, params: SqlValue[]) {
      await watch(on, sql);
      return (db.prepare(sql).get(...params) ?? null) as T | null;
    },
    async execAsync(sql: string) {
      await watch(on, sql);
      db.exec(sql);
    },
  };
}

/**
 * The handle a transaction body is given.
 *
 * Refuses nesting, and its `closeAsync` is a no-op — matching the real
 * `Transaction`, whose connection is closed by the call that created it.
 */
function transactionHandle(db: DatabaseSync, watch: Watch): SqliteConnection {
  return {
    ...statementsOn(db, 'txn', watch),
    async withExclusiveTransactionAsync() {
      // Real `Transaction` extends the database type, so nesting type-checks
      // and then deadlocks. The driver refuses it a level up; if that ever
      // regresses, this is where it gets caught rather than hanging the suite.
      throw new Error('nested transaction on the transaction connection');
    },
    async closeAsync() {
      // A no-op: the outer connection outlives the transaction.
    },
  };
}

export interface FakeConnection extends SqliteConnection {
  /** The database file, so a test can open a third connection against it. */
  readonly file: string;

  /**
   * Statements issued on the OUTER connection while a transaction was open.
   *
   * Should always be empty: `gate.ts` holds everything else back for exactly
   * as long as a transaction is running. A non-empty list means a statement
   * overlapped a transaction, which on device is how a read ends up prepared
   * against a connection expo has already closed.
   */
  readonly strays: string[];
}

export function fakeExpoConnection(): FakeConnection {
  const file = tempFile();
  const db = openConnection(file);

  /**
   * WAL from the start, because on device it always is.
   *
   * `open.ts` runs `applyPragmas` on every connection it opens, and unlike the
   * others this one sticks: WAL lives in the database file header rather than
   * on the handle, so the transaction's connection inherits it. Setting it here
   * is what makes a read during a write behave the way it does on a handset
   * instead of the way a rollback journal would.
   */
  db.exec('PRAGMA journal_mode = WAL;');

  const strays: string[] = [];
  let open = false;

  const watch: Watch = (on, sql) => {
    if (on === 'db' && open) strays.push(sql);
  };

  return {
    file,
    strays,
    ...statementsOn(db, 'db', watch),

    /**
     * A second connection, held for the transaction and closed after it —
     * expo's `SQLiteDatabase.withExclusiveTransactionAsync`, which BEGINs, runs
     * the task, COMMITs, ROLLBACKs on any throw, and closes the connection in a
     * `finally` regardless.
     */
    async withExclusiveTransactionAsync(task) {
      const txnDb = openConnection(file);
      open = true;
      try {
        txnDb.exec('BEGIN');
        try {
          await task(transactionHandle(txnDb, watch));
          txnDb.exec('COMMIT');
        } catch (error) {
          txnDb.exec('ROLLBACK');
          throw error;
        }
      } finally {
        open = false;
        // Closed without waiting for anything still in flight against it,
        // exactly as expo does. A statement that lands after this gets
        // `node:sqlite`'s own "database is not open" rather than a fabricated
        // error — see `tracingExpoConnection` for the device's wording.
        txnDb.close();
      }
    },

    async closeAsync() {
      db.close();
    },
  };
}

/**
 * The same two connections, plus the native lifecycle that produced the crash.
 *
 * On device a statement prepared against the transaction's connection after it
 * is gone fails inside expo-modules-core's shared-object registry — the "Cannot
 * use shared object that was already released" the emulator reported. Node
 * raises its own error for a closed database; this reports expo's wording so a
 * regression reads here the way it reads in logcat.
 *
 * `where` records which connection every statement actually ran on, which is
 * the property under test: a read that has nothing to do with the transaction
 * must never touch the transaction's connection.
 */
export interface TracingConnection extends FakeConnection {
  /** One entry per statement: `db` or `txn`, and the SQL. */
  readonly where: { on: 'db' | 'txn'; sql: string }[];
}

export function tracingExpoConnection(
  /**
   * Milliseconds a statement spends in flight before it touches the
   * connection, modelling the JSI hop onto `Dispatchers.IO` and back. Zero is
   * fine for routing assertions; a non-zero value is what makes "still in
   * flight when the connection was released" reachable at all.
   */
  latencyMs = 0,
): TracingConnection {
  const file = tempFile();
  const db = openConnection(file);
  db.exec('PRAGMA journal_mode = WAL;');

  const where: { on: 'db' | 'txn'; sql: string }[] = [];
  const strays: string[] = [];
  let open = false;
  let released = false;

  /**
   * The connection is recorded when the statement is ISSUED and checked when
   * it lands, which is the whole shape of the crash: the driver chose the
   * connection at call time, and the native side prepared against it later.
   */
  const watch: Watch = async (on, sql) => {
    where.push({ on, sql });
    if (on === 'db' && open) strays.push(sql);
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
    if (on === 'txn' && released) {
      // Verbatim from expo-modules-core's SharedObjectRegistry.
      throw new Error('Cannot use shared object that was already released');
    }
  };

  return {
    file,
    where,
    strays,
    ...statementsOn(db, 'db', watch),

    async withExclusiveTransactionAsync(task) {
      const txnDb = openConnection(file);
      open = true;
      released = false;
      try {
        txnDb.exec('BEGIN');
        try {
          await task(transactionHandle(txnDb, watch));
          txnDb.exec('COMMIT');
        } catch (error) {
          txnDb.exec('ROLLBACK');
          throw error;
        }
      } finally {
        // expo closes the transaction's connection here, synchronously with
        // the end of the task and regardless of what is still in flight.
        open = false;
        released = true;
        txnDb.close();
      }
    },

    async closeAsync() {
      db.close();
    },
  };
}
