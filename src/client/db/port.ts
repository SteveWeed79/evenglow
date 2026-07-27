import type { Entity, MutationResult, Op, PulledMutation } from '@steading/contracts';
import type { LocalRecord, Quarantined, QueuedMutation } from './schema';

/**
 * The storage port.
 *
 * The sync engine's dependency on the browser lives entirely behind this
 * interface. IndexedDB implements it today; SQLite implements it on native.
 * Everything above — sequence monotonicity, single-flight flushing,
 * poison-batch parking, the integrity check, pull's pending-edit protection —
 * is storage-shaped rather than browser-shaped, and does not change.
 *
 * These are ATOMIC DOMAIN OPERATIONS, not key-value primitives, and that is
 * the whole point. `enqueue` mints a sequence number, writes the outbox row,
 * advances the counter and updates the projection as one unit. Exposing those
 * as four separate calls would let an implementation quietly lose the property
 * that a crash mid-write cannot duplicate a clientSeq — the exact defect this
 * codebase went to some trouble to make impossible.
 *
 * A new implementation is correct when it passes the same suite as the old
 * one. That is the contract; nothing here should need a second reading of the
 * engine to satisfy.
 */

export interface EnqueueRequest {
  entity: Entity;
  op: Op;
  targetId: string;
  /** Already validated against the entity's contract by the caller. */
  payload: unknown;
}

export interface QueueCounts {
  queued: number;
  rejected: number;
  total: number;
}

export interface IntegrityReport {
  everEnqueued: number;
  cleared: number;
  expectedInOutbox: number;
  actualInOutbox: number;
  /** Positive when records left storage without the server acknowledging them. */
  missing: number;
}

export interface PullResult {
  applied: number;
  skipped: number;
}

export interface LocalStore {
  // ── Writing ───────────────────────────────────────────────────────────────

  /**
   * Mints the next clientSeq, writes the outbox entry, advances the counter,
   * and applies the optimistic projection — atomically, or not at all.
   *
   * Implementations MUST derive the sequence floor from the highest seq still
   * in the outbox when the stored counter is missing or unreadable. Falling
   * back to zero reuses sequence numbers and silently breaks ordering.
   *
   * MUST surface a full device as StorageFullError rather than a raw throw.
   */
  enqueue(request: EnqueueRequest): Promise<QueuedMutation>;

  /**
   * Applies a batch's server results as one unit: applied and duplicate are
   * removed and counted as cleared, anything else is marked rejected with its
   * reason and KEPT. A mutation absent from `results` stays queued — resending
   * is safe, so silence must never be read as success.
   */
  resolveBatch(batch: readonly QueuedMutation[], results: readonly MutationResult[]): Promise<void>;

  /** Increments attempts and records the error, without changing status. */
  recordAttempt(batch: readonly QueuedMutation[], error: string): Promise<void>;

  /** Marks anything at or past the attempt ceiling as rejected, so the queue can drain. */
  rejectExhausted(
    batch: readonly QueuedMutation[],
    maxAttempts: number,
    reason: string,
  ): Promise<void>;

  // ── The inbox ─────────────────────────────────────────────────────────────

  listRejected(): Promise<QueuedMutation[]>;
  /** Returns a rejected mutation to the queue with a clean attempt count. */
  retryRejected(id: string, payload?: unknown): Promise<void>;
  /**
   * Removes a rejected mutation. MUST bump the cleared counter: a discard is a
   * resolution, and skipping it makes the integrity check report data loss
   * later for something the user did on purpose.
   */
  discardRejected(id: string): Promise<void>;

  // ── Reading ───────────────────────────────────────────────────────────────

  /**
   * Outbox entries in clientSeq order — the order they must be sent in.
   *
   * MUST migrate old envelopes up to the current schema version, and MUST
   * quarantine an unreadable row rather than throwing: one bad record must not
   * stop every mutation behind it from ever being sent.
   */
  readOutboxBySeq(): Promise<QueuedMutation[]>;

  /** Local projections for one entity kind. Indexed, not a full scan. */
  readRecordsByEntity(entity: string): Promise<LocalRecord[]>;

  counts(): Promise<QueueCounts>;
  checkIntegrity(): Promise<IntegrityReport>;

  // ── Hydration ─────────────────────────────────────────────────────────────

  /**
   * Applies a page of pulled mutations and advances the watermark, atomically.
   *
   * MUST skip any record with a pending local edit. A queued change visibly
   * reverting is the most alarming thing an offline app can do, so local
   * optimistic state wins until it flushes.
   */
  applyPulled(mutations: readonly PulledMutation[], through: number): Promise<PullResult>;

  pulledThrough(): Promise<number>;

  // ── Bookkeeping ───────────────────────────────────────────────────────────

  getLastSyncAt(): Promise<number | null>;
  getLastError(): Promise<string | null>;
  setLastError(message: string): Promise<void>;
  getDeviceId(): Promise<string | null>;

  quarantineCount(): Promise<number>;
  listQuarantined(): Promise<Quarantined[]>;

  /**
   * Clears every store. Called on sign-out and org switch (C5) — cached tenant
   * data must not outlive the session that fetched it.
   */
  wipe(): Promise<void>;

  /** Releases any handle. Reopening from scratch must be safe. */
  close(): Promise<void>;
}
