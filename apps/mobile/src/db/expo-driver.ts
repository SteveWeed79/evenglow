import type { SqlDriver, SqlValue } from '@steading/core/db/driver';

/**
 * A `SqlDriver` over `expo-sqlite`. The device backing for `LocalStore`.
 *
 * Written against the same seam as the Node driver the test suite uses, so
 * everything above it — sequence monotonicity, atomic enqueue, quarantine, the
 * migration ladder — is already proven by 430 tests before this file runs. Its
 * only job is to be a faithful SQLite, and the two ways the last driver was
 * unfaithful are both handled deliberately below.
 *
 * ## Two lessons carried over from the Capacitor driver
 *
 * **Use the library's transaction, not raw BEGIN.** The previous driver drove
 * `BEGIN`/`COMMIT` by hand and the plugin's own queueing interleaved
 * statements into them. `withExclusiveTransactionAsync` opens a second
 * connection, holds the write lock, and commits or rolls back as one unit.
 *
 * **Row-returning statements go through the query path.** Android's `execSQL`
 * refuses anything that returns rows, which is how `PRAGMA journal_mode = WAL`
 * failed silently-then-loudly last time. `getFirstAsync` is used for it here,
 * because that PRAGMA reports the mode it settled on.
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

export function createExpoDriver(db: SqliteConnection): SqlDriver {
  /**
   * Statements are routed to the transaction's connection while one is open.
   *
   * Not a nicety. `withExclusiveTransactionAsync` runs on a SECOND connection
   * holding the write lock, so a statement sent to `db` during a transaction
   * does not join it — it contends with it, and the documented outcome is
   * `database is locked`. Every read and write inside `work()` must land on
   * the same handle that will be committed.
   */
  let active: SqliteConnection | null = null;
  const handle = (): SqliteConnection => active ?? db;

  /**
   * Transactions run one at a time, chained off this promise.
   *
   * A connection holds one transaction, so two overlapping calls would share
   * it, each able to roll back the other's writes. Two taps on the Tally in
   * quick succession is enough to reach that.
   */
  let tail: Promise<unknown> = Promise.resolve();

  return {
    async run(sql, params = []) {
      await handle().runAsync(sql, params as SqlValue[]);
    },

    async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
      return handle().getAllAsync<T>(sql, params as SqlValue[]);
    },

    async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> {
      // expo-sqlite reports "no row" as null; the port's contract is undefined.
      // Converted here rather than at the call sites, because a null reaching a
      // Zod parse is a confusing error a long way from its cause.
      const row = await handle().getFirstAsync<T>(sql, params as SqlValue[]);
      return row ?? undefined;
    },

    async transaction<T>(work: () => Promise<T>): Promise<T> {
      // Refused rather than deadlocked. Serialising means a nested call would
      // wait on the transaction it is already inside, and a hang is far harder
      // to diagnose than a thrown error naming the rule.
      if (active) {
        throw new Error('Nested transactions are not supported; see SqlDriver.transaction.');
      }

      const run = async (): Promise<T> => {
        let result!: T;
        await db.withExclusiveTransactionAsync(async (txn) => {
          active = txn;
          try {
            result = await work();
          } finally {
            // Cleared inside the task, before the commit that follows it, so a
            // throw in work() cannot leave a closed connection as the handle.
            active = null;
          }
        });
        return result;
      };

      // Chain off the tail whether or not the previous call succeeded — one
      // caller's rollback must not strand everyone queued behind it.
      const queued = tail.then(run, run);
      tail = queued.catch(() => undefined);
      return queued;
    },

    async close() {
      await db.closeAsync();
    },
  };
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
