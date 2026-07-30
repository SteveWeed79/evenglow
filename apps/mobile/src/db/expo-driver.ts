import { createGate, type GateOptions } from '@steading/core/db/gate';
import type { SqlDriver, SqlOps, SqlValue } from '@steading/core/db/driver';

/**
 * A `SqlDriver` over `expo-sqlite`. The device backing for `LocalStore`.
 *
 * Written against the same seam as the Node driver the test suite uses, so
 * everything above it — sequence monotonicity, atomic enqueue, quarantine, the
 * migration ladder — is already proven by 430 tests before this file runs. Its
 * only job is to be a faithful SQLite, and the three ways the last two drivers
 * were unfaithful are all handled deliberately below.
 *
 * ## Three lessons, one per driver generation
 *
 * **Use the library's transaction, not raw BEGIN.** The Capacitor driver drove
 * `BEGIN`/`COMMIT` by hand and the plugin's own queueing interleaved
 * statements into them. `withExclusiveTransactionAsync` opens a second
 * connection, holds it for the duration, and commits or rolls back as one unit.
 *
 * **Row-returning statements go through the query path.** Android's `execSQL`
 * refuses anything that returns rows, which is how `PRAGMA journal_mode = WAL`
 * failed silently-then-loudly. `getFirstAsync` is used for it here, because
 * that PRAGMA reports the mode it settled on.
 *
 * **Which connection a statement uses is decided lexically, never from
 * ambient state.** The first Expo driver kept a module-level `active`
 * connection and sent every `run`/`all`/`get` to it while a transaction was
 * open. That is unanswerable by construction: the driver sees the same call
 * from a statement inside the transaction body and from a screen refresh that
 * merely overlapped it. Today's list issues eleven reads in one burst on every
 * engine publish, and the sync engine opens transactions from a timer, so the
 * overlap was routine — those reads were sent to the transaction's connection,
 * and `withExclusiveTransactionAsync` closes that connection in a `finally`
 * without waiting for them. Now the transaction body is handed its own `SqlOps`
 * and everything else waits behind it in `gate`, so a statement's connection is
 * a property of where it was written, not of when it ran.
 *
 * ## Why this file names its own connection type
 *
 * Nothing here imports `expo-sqlite`. `SqliteConnection` below is exactly the
 * surface of it this driver uses — six methods — and `open.ts` next door is
 * the only file that names the real package.
 *
 * That is not decoration. `expo-sqlite` is a native module: importing it in
 * Node throws, so a driver that imported it directly could only ever be
 * exercised on a handset. The last driver was written that way and shipped two
 * bugs that a five-line fake would have caught on the first run. This one is
 * tested in the same suite as everything else.
 */

/** Exactly the surface of `expo-sqlite`'s database this driver depends on. */
export interface SqliteConnection {
  runAsync(source: string, params: SqlValue[]): Promise<unknown>;
  getAllAsync<T>(source: string, params: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params: SqlValue[]): Promise<T | null>;
  execAsync(source: string): Promise<void>;
  withExclusiveTransactionAsync(task: (txn: SqliteConnection) => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

/**
 * The statement surface bound to one connection.
 *
 * `beat` tells the lane's stall guard that this holder is still working; only
 * a transaction's handle passes a real one.
 */
function opsOn(
  connection: SqliteConnection,
  beat: () => void,
  transaction: SqlOps['transaction'],
): SqlOps {
  return {
    async run(sql, params = []): Promise<void> {
      beat();
      await connection.runAsync(sql, params as SqlValue[]);
    },

    async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
      beat();
      return connection.getAllAsync<T>(sql, params as SqlValue[]);
    },

    async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> {
      beat();
      // expo-sqlite reports "no row" as null; the port's contract is undefined.
      // Converted here rather than at the call sites, because a null reaching a
      // Zod parse is a confusing error a long way from its cause.
      const row = await connection.getFirstAsync<T>(sql, params as SqlValue[]);
      return row ?? undefined;
    },

    transaction,
  };
}

/** The transaction handle's own `transaction`: always a refusal. */
function refuseNesting<T>(): Promise<T> {
  // Thrown at the point of the mistake rather than deadlocked behind the lane.
  // A hang on a handset produces no message, no log line and no crash report;
  // this produces a stack pointing at the offending call.
  return Promise.reject(
    new Error('Nested transactions are not supported; see SqlOps.transaction.'),
  );
}

export function createExpoDriver(db: SqliteConnection, gateOptions: GateOptions = {}): SqlDriver {
  /**
   * One lane for every operation on this file — reads included.
   *
   * Serialising transactions alone is not enough. The connection a statement
   * runs on has to be decided when the statement is written, and that is only
   * enforceable if no statement can be issued while a transaction is open. See
   * `gate.ts` and the port doc.
   *
   * `gateOptions` exists so a test can drive the stall guard's clock. Nothing
   * in the app passes it; `open.ts` takes the defaults.
   */
  const gate = createGate(gateOptions);

  const outer = (): SqlOps =>
    opsOn(db, () => undefined, (work) => driver.transaction(work));

  const driver: SqlDriver = {
    run(sql, params = []): Promise<void> {
      return gate.enter(() => outer().run(sql, params));
    },

    all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
      return gate.enter(() => outer().all<T>(sql, params));
    },

    get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> {
      return gate.enter(() => outer().get<T>(sql, params));
    },

    transaction<T>(work: (tx: SqlOps) => Promise<T>): Promise<T> {
      return gate.enter(async (beat) => {
        let result!: T;
        let ran = false;

        await db.withExclusiveTransactionAsync(async (txn) => {
          ran = true;
          result = await work(opsOn(txn, beat, refuseNesting));
        });

        // A transaction that never invoked its body has committed nothing but
        // would return `undefined` typed as T. Silent, and precisely the shape
        // of bug invariant 5 exists to prevent.
        if (!ran) throw new Error('The transaction body never ran.');
        return result;
      }, true);
    },

    close(): Promise<void> {
      // Queued behind everything else, so no statement can be in flight against
      // a connection that is being closed.
      return gate.enter(() => db.closeAsync());
    },
  };

  return driver;
}

/**
 * The PRAGMAs durability rests on, applied to a freshly opened connection.
 *
 * Separate from `createExpoDriver` so a test can assert both were attempted,
 * and attempted through the right method, without an emulator. That seam
 * exists because the Capacitor driver shipped a broken `journal_mode` that no
 * test could have caught.
 */
export async function applyPragmas(db: SqliteConnection): Promise<void> {
  /**
   * WAL, and it is checked rather than assumed.
   *
   * `PRAGMA journal_mode` RETURNS the mode it settled on, which is why it goes
   * through the query path. SQLite silently declines WAL on filesystems that
   * cannot support the shared-memory file, and the app would then run in
   * rollback-journal mode — correct, but with materially worse crash and
   * concurrency behaviour than the exit gate assumes.
   */
  const journal = await db.getFirstAsync<{ journal_mode?: string }>('PRAGMA journal_mode = WAL;', []);
  const mode = journal?.journal_mode?.toLowerCase();
  if (mode !== 'wal') {
    // Warn, never throw. A farm's records opening in a slower journal mode is
    // enormously better than a farm's records not opening.
    console.warn(`[steading] SQLite journal_mode is "${mode ?? 'unknown'}", expected "wal".`);
  }

  /**
   * FULL, not NORMAL.
   *
   * Under WAL, NORMAL lets recent commits be lost on power failure — a device
   * dying in a barn is exactly the case this app exists for. FULL costs an
   * fsync per commit, and a commit here is one person logging one tally.
   */
  await db.execAsync('PRAGMA synchronous = FULL;');

  // Nothing uses foreign keys yet; a future table that does should not
  // silently lose its constraint.
  await db.execAsync('PRAGMA foreign_keys = ON;');
}
