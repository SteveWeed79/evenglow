/**
 * The SQL seam.
 *
 * `LocalStore` is written once against this interface and gets two backings:
 * `expo-sqlite` on device, and `node:sqlite` under test. That split exists for
 * a specific reason rather than tidiness — the storage layer is the
 * highest-risk part of this migration (D9 changes durability characteristics),
 * and a layer that can only be exercised on a handset is a layer that gets
 * exercised rarely and late.
 *
 * It is deliberately narrow. Anything clever — upserts, batching, retries —
 * belongs above this, where it is testable, not in two drivers that then have
 * to agree.
 */

export type SqlValue = string | number | null;

/**
 * The statement surface. A driver is one of these; so is the handle a
 * transaction hands to its body.
 *
 * They are the same shape on purpose: a helper that takes `SqlOps` can be
 * called from inside a transaction and from outside it without two signatures,
 * and the only difference between the two is which object it was given.
 */
export interface SqlOps {
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
   * **The body MUST use the handle it is given, and nothing else.**
   *
   * `work` receives the transaction's own `SqlOps`. That is not a convenience,
   * it is the correctness boundary. A driver cannot tell a statement issued
   * from inside `work` from an unrelated read that merely overlapped it —
   * they arrive at the same method with the same arguments — so the previous
   * driver guessed from ambient state and routed both onto the transaction's
   * connection. Every read Today's list issued during a sync transaction went
   * there too, and when the transaction committed and released that connection
   * the reads still in flight were left prepared against a released native
   * object. Passing the handle replaces the guess with a lexical fact.
   *
   * **Every operation is serialised, not just transactions.**
   *
   * One SQLite connection holds one transaction, so two overlapping
   * `transaction` calls are not two transactions — they are one, with two
   * callers writing into it and either able to roll back the other's work.
   * The same lane also carries `run`, `all` and `get`, which is what makes the
   * paragraph above enforceable: while a transaction is open nothing else is
   * running, so nothing else can be misrouted into it or outlive it.
   *
   * **Nesting is refused rather than silently supported via SAVEPOINT.**
   *
   * Calling `transaction` on the handle throws immediately, naming the rule.
   * Reaching past the handle to the outer driver instead is a deadlock — the
   * nested call queues behind the transaction that is waiting for it — and the
   * lane's stall guard turns that into a named error rather than a hang. No
   * operation in `LocalStore` nests.
   */
  transaction<T>(work: (tx: SqlOps) => Promise<T>): Promise<T>;
}

export interface SqlDriver extends SqlOps {
  close(): Promise<void>;
}
