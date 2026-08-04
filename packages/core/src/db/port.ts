import type { Entity, MutationResult, Op, PulledMutation } from '@steading/contracts';
import type { LocalRecord, Quarantined, QueuedMutation } from './records';

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

/**
 * How far this device has hydrated. Both halves, always — see `applyPulled`.
 * `throughId` is null only before the first row has ever been read.
 */
export interface SnapshotWatermark {
  through: number;
  throughId: string | null;
}

/** A forecast as it sits in the cache. `value` is the JSON, unparsed. */
export interface CachedForecast {
  issuedAt: number;
  fetchedAt: number;
  value: string;
}

/**
 * A measured reading as it sits in the cache. `value` is the JSON, unparsed.
 *
 * `observedAt` is when the station took the reading and `fetchedAt` is when
 * this device asked — the same split as the forecast, and it matters more
 * here: a twenty-minute-old reading fetched a second ago is still a
 * twenty-minute-old reading, and on an afternoon that is climbing fast that
 * is the number worth showing beside it.
 */
export interface CachedObservation {
  observedAt: number;
  fetchedAt: number;
  value: string;
}

/**
 * The last set of official alerts, whole.
 *
 * One row holding the entire active set rather than a row per alert, because
 * the set is what the service answers with — an alert that has been cancelled
 * is simply absent from the next response, and rows kept individually would
 * need a reconciliation pass to notice. Replacing the blob cannot leave a
 * lapsed tornado warning behind.
 */
export interface CachedAlerts {
  fetchedAt: number;
  value: string;
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
   * reason and KEPT.
   *
   * A mutation absent from `results` stays queued with its attempt count
   * incremented — resending is safe, so silence must never be read as success,
   * but it must also not retry forever unnoticed.
   */
  resolveBatch(batch: readonly QueuedMutation[], results: readonly MutationResult[]): Promise<void>;

  /**
   * Records a successful exchange with the server: stamps the sync time and
   * clears the last error.
   *
   * One call rather than two, because a sync that succeeded and a stale error
   * message on the diagnostics sheet must not be able to coexist — which is
   * exactly what happens if a caller remembers one and forgets the other.
   */
  markSynced(at: number): Promise<void>;

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
   *
   * The watermark is a PAIR, and this signature took a `through: number` until
   * the SQLite implementation was written against it. That would have been a
   * silent regression: serverTs is millisecond-resolution, so persisting the
   * timestamp without its ULID resumes from the start of a millisecond and
   * loses every row after a page boundary that falls inside one. The bug was
   * fixed in the engine before this file was updated to match — a reminder
   * that "implement the port" is only as correct as the port.
   */
  applyPulled(
    mutations: readonly PulledMutation[],
    cursor: SnapshotWatermark,
  ): Promise<PullResult>;

  pulledThrough(): Promise<SnapshotWatermark>;

  // ── Bookkeeping ───────────────────────────────────────────────────────────

  getLastSyncAt(): Promise<number | null>;
  getLastError(): Promise<string | null>;
  setLastError(message: string): Promise<void>;
  getDeviceId(): Promise<string | null>;

  // ── Forecast cache ────────────────────────────────────────────────────────

  /**
   * The cached forecast, or null.
   *
   * Its own pair of methods rather than a `meta` key, because `meta` is small
   * bookkeeping — a device id, a watermark, a last error — and this is a blob
   * that is replaced wholesale. Keeping them apart means a corrupt forecast
   * cannot take the device id with it.
   *
   * **Deliberately not part of the record or outbox system.** A forecast is
   * not authored, cannot conflict, and must never reach the wire; see
   * `weather/provider.ts` and `contracts/weather.ts`.
   */
  readForecast(): Promise<CachedForecast | null>;
  writeForecast(entry: CachedForecast): Promise<void>;

  /**
   * The last measured reading, or null.
   *
   * Separate from the forecast because the two go out of date at completely
   * different rates: a forecast run is regenerated hourly and is stale after
   * two days, while a reading from an airfield thermometer is worthless within
   * the hour. Sharing one row would force the slower to govern the faster.
   */
  readObservation(): Promise<CachedObservation | null>;
  writeObservation(entry: CachedObservation): Promise<void>;

  /**
   * The last set of official watches and warnings, or null.
   *
   * Its own row again, and for the third distinct rate: an alert is issued and
   * cancelled on a scale of minutes, faster than either the forecast or the
   * station reading. It is also the only one of the three where showing a
   * lapsed value is dangerous rather than merely wrong.
   */
  readAlerts(): Promise<CachedAlerts | null>;
  writeAlerts(entry: CachedAlerts): Promise<void>;

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
