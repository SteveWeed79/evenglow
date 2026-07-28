/**
 * The SQL seam.
 *
 * `LocalStore` is written once against this interface and gets two backings:
 * `@capacitor-community/sqlite` on device, and `node:sqlite` under test. That
 * split exists for a specific reason rather than tidiness — the storage layer
 * is the highest-risk part of this migration (D9 changes durability
 * characteristics), and a layer that can only be exercised on a handset is a
 * layer that gets exercised rarely and late.
 *
 * It is deliberately narrow. Anything clever — upserts, batching, retries —
 * belongs above this, where it is testable, not in two drivers that then have
 * to agree.
 */

export type SqlValue = string | number | null;

export interface SqlDriver {
  /** A statement with no result. */
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;

  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;

  get<T>(sql: string, params?: readonly SqlValue[]): Promise<T | undefined>;

  /**
   * Runs `work` inside one transaction: it commits, or nothing in it happened.
   *
   * This is the method invariant 5 rests on. Enqueue mints a sequence number,
   * writes the outbox row, advances the counter and updates the projection —
   * and a partial application of that set is precisely the state the whole
   * design exists to make impossible. An implementation that quietly
   * auto-commits between statements satisfies the type and breaks the app.
   *
   * **Concurrent calls are serialised, and nesting is not supported.**
   *
   * A SQLite connection has one transaction at a time, so two overlapping
   * calls are not two transactions — they are one, with two callers writing
   * into it and either able to roll back the other's work. Two taps on the
   * Tally in quick succession is enough to reach that, so implementations
   * queue instead: the second call waits for the first to commit.
   *
   * Nesting is refused rather than silently supported via SAVEPOINT. Once
   * calls are serialised, a nested call would wait on the transaction it is
   * already inside and deadlock, and the only way to tell "nested" from
   * "concurrent" is async context tracking that does not exist in a WebView.
   * No operation in `LocalStore` nests, so this costs nothing and removes a
   * class of bug that would only appear under load on a device.
   */
  transaction<T>(work: () => Promise<T>): Promise<T>;

  close(): Promise<void>;
}
