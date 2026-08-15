import type { SyncRefusal } from '@steading/contracts';
import type { Entity, MutationResult, Op, PulledMutation } from '@steading/contracts';
import type { LocalRecord, Quarantined, QueuedMutation } from './records';
import type { metaSchemas } from './schema';
import type { z } from 'zod';

/** Why a device stopped being signed in — see `metaSchemas.sessionEnd`. */
export type SessionEnd = z.infer<(typeof metaSchemas)['sessionEnd']>;

/** A photo the camera was opened for — see `metaSchemas.pendingPhoto`. */
export type PendingPhoto = z.infer<(typeof metaSchemas)['pendingPhoto']>;

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

export interface StoredTicket {
  id: string;
  at: number;
  fingerprint: string;
  /** The lean bundle, serialised. */
  bundle: string;
  /**
   * The farm's records, when they were asked for and agreed to (S2).
   *
   * Stored beside the bundle rather than regenerated at send time, because
   * consent was given about *this* moment's data: a farm that says yes on
   * Tuesday and sends on Thursday agreed to Tuesday's records, and re-reading
   * the database at send would quietly widen that.
   */
  records?: string | undefined;
  attempts: number;
  lastError?: string | undefined;
  sentAt?: number | undefined;
  url?: string | undefined;
}

export interface PullResult {
  applied: number;
  skipped: number;
  /**
   * True when hydration stopped at a record this device has not sent yet.
   *
   * The watermark was NOT advanced past that record, so the caller must stop
   * paging: everything from here on is still owed and will be offered again
   * once the outbox drains. Without this the loop would page forward on the
   * server's cursor and re-fetch the same rows on the next pass.
   */
  paused: boolean;
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
   * The same guarantee across SEVERAL mutations: all of them, in the order
   * given, or none of them.
   *
   * For the case where one thing a farmer did is more than one mutation, and
   * the half-done state is wrong. A restore puts an archived record back as a
   * `create` followed by a `delete` — "archived" is not a field any create
   * schema has, it is the outcome of a delete — and two separate `enqueue`
   * calls meant a crash or a full disk between them left the record **live**.
   * A retired flock reappears on every screen on the morning somebody sets the
   * new phone up, and the resume pass does not repair it because the record is
   * present and that is all it checks.
   *
   * Sequence numbers are consecutive and in argument order, so the server
   * applies them in the order they were meant. Implementations MUST project
   * each one before building the next, or a mutation that depends on its
   * predecessor's projection — which is exactly the `delete` above — sees a
   * record that is not there yet.
   */
  enqueueAll(requests: readonly EnqueueRequest[]): Promise<QueuedMutation[]>;

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

  /**
   * How many records this farm holds, across every entity.
   *
   * A count rather than a read, because the one caller that needs it renders
   * every morning — and the honest alternatives were both wrong. Reading all
   * twenty-six entities is a full scan of the farm on Today, and counting
   * outbox rows instead is not the same number: a never-synced farm that
   * created a group and edited it three times has four mutations and one
   * record, so a strip reading "1,540 records" would be about roughly 1,200
   * of them. The word on the screen is the load-bearing part.
   *
   * Archived rows count. A retired group is still a record and still the
   * history its logs name.
   */
  countRecords(): Promise<number>;

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

  /**
   * The one-time projection repair (`PROJECTION_REPAIR`).
   *
   * Devices that synced before the server learned to withhold refused commands
   * applied some of them as truth, and hydration replays the log — so a
   * reinstall reproduced the wrong state rather than repairing it. Nothing an
   * ordinary sync does reaches those rows, so the device replays the accepted
   * log from zero once and then sweeps whatever the replay never touched.
   *
   * MUST be non-destructive until the replay completes. A device that is
   * offline, or that never finishes, keeps every row it had: the sweep runs
   * only after the feed has actually run out, because only then does "the
   * replay never touched this" mean "the server has nothing for this".
   *
   * `start` MUST be idempotent on its own marker rather than on the watermark,
   * or a device restarts the replay on every pull and never finishes it.
   */
  startProjectionRepair(): Promise<boolean>;
  finishProjectionRepair(): Promise<number>;
  projectionRepairDone(): Promise<boolean>;

  // ── Bookkeeping ───────────────────────────────────────────────────────────

  getLastSyncAt(): Promise<number | null>;
  getLastError(): Promise<string | null>;
  setLastError(message: string): Promise<void>;
  getDeviceId(): Promise<string | null>;

  /**
   * Why the server is holding this farm's work, or null when it is not (D13).
   *
   * Persisted so the chip is right on the first frame after a cold start.
   * Held in memory it would leave a free-tier farm reading "340 waiting" every
   * morning until the first flush corrected it — and `waiting` is the exact
   * lie this state exists to stop telling.
   */
  getSyncHeld(): Promise<SyncRefusal | null>;
  setSyncHeld(refusal: SyncRefusal | null): Promise<void>;

  /**
   * When a backup file was last written from this device, or null.
   *
   * Here rather than in secure storage because it is a fact about this farm's
   * records, and the records are what it is read against — a device holding
   * two farms over its life must not carry one farm's backup date onto the
   * other's screen. The database is per farm; secure storage is not.
   */
  getLastBackupAt(): Promise<number | null>;
  setLastBackupAt(at: number): Promise<void>;

  /**
   * Official weather alerts this device has been told about, by service id.
   *
   * NOT a dismissal, and the distinction is the whole design — an acknowledged
   * alert still draws, still opens, still carries its full text. It collapses
   * to a line. See `metaSchemas.readAlerts` for why that makes device-local
   * storage the right answer here and the wrong one for silence.
   *
   * The setter takes the ids still in force alongside, and stores only the
   * intersection, so a device that has been running for a year is not holding
   * a list of every warning it has ever seen.
   */
  getReadAlerts(): Promise<string[]>;
  markAlertRead(id: string, live: readonly string[]): Promise<void>;

  /**
   * Why this device stopped being signed in — see `metaSchemas.sessionEnd`.
   *
   * On the local store rather than in secure storage because it is not a
   * credential: it is one sentence about something that already happened, and
   * it has to survive being read on the Diagnostics screen by somebody who is
   * currently signed out.
   */
  /** A photo the camera was opened for — see `metaSchemas.pendingPhoto`. */
  getPendingPhoto(): Promise<PendingPhoto | null>;
  setPendingPhoto(pending: PendingPhoto | null): Promise<void>;

  getSessionEnd(): Promise<SessionEnd | null>;
  recordSessionEnd(end: SessionEnd | null): Promise<void>;

  // ── Support tickets ───────────────────────────────────────────────────────

  /**
   * A report, held until it can be sent (`docs/SUPPORT-LOOP.md` S6).
   *
   * The same promise the mutation queue makes and for the same reason: the
   * farm is in a barn and the problem happened *now*. Deliberately not in the
   * outbox — a ticket is not a farm record, does not sync between devices, and
   * must never be replayed onto the server as a mutation.
   */
  enqueueTicket(ticket: StoredTicket): Promise<void>;
  /** Unsent, oldest first. */
  pendingTickets(): Promise<StoredTicket[]>;
  /** Every ticket, newest first, so a screen can say what happened to one. */
  listTickets(limit?: number): Promise<StoredTicket[]>;
  /**
   * Marks it sent, keeping the row.
   *
   * The same reasoning as invariant 7: the history is how somebody can tell
   * whether the report they filed ever left the phone.
   */
  markTicketSent(id: string, at: number, url: string | null): Promise<void>;
  recordTicketAttempt(id: string, error: string): Promise<void>;
  /** Explicit, and the only way a ticket leaves. */
  dropTicket(id: string): Promise<void>;

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
