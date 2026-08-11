import { z } from 'zod';
import { mutationSchema, SYNC_REFUSALS } from '@steading/contracts';

/**
 * The shapes the offline engine stores, independent of what stores them.
 *
 * Everything read back out of storage is parsed through these (invariant 11).
 * Storage is external data: it survives across app versions, can be edited by
 * hand, and can be corrupted by a failed migration, so it is never trusted on
 * the way in.
 *
 * Shared by the IndexedDB engine and the SQLite one during the migration. A
 * second copy would let the two drift, and the whole point of running one
 * suite against both is that they cannot.
 */

/** Local lifecycle, distinct from the server's per-mutation result status. */
const LOCAL_STATUSES = ['queued', 'sending', 'rejected', 'applied'] as const;

/**
 * A mutation in the outbox: the wire envelope plus local bookkeeping.
 *
 * **Nothing leaves this store because it succeeded.** A mutation the server
 * accepted is marked `applied` and stays, which is hard invariant 7 — history
 * is the audit trail and the duplicate defence. It used to be deleted, so the
 * only record that a farm's morning had ever been sent was that the row was
 * gone, which is indistinguishable from the row never having existed.
 *
 * Rejections flip status and stay too (A6), so "never drop a rejected
 * mutation" is a property of the storage layer rather than a rule the flush
 * loop has to remember.
 *
 * The one deletion that remains is a user deliberately discarding a rejected
 * record, and it is guarded on that status — see `discardRejected`.
 */
export const queuedMutationSchema = mutationSchema.extend({
  status: z.enum(LOCAL_STATUSES),
  attempts: z.number().int().nonnegative(),
  enqueuedAt: z.number().int(),
  lastError: z.string().optional(),
  rejectedReason: z.string().optional(),
  rejectedAt: z.number().int().optional(),
});

export type QueuedMutation = z.infer<typeof queuedMutationSchema>;

/**
 * Optimistic local projection, so what you logged offline is visible at cold
 * start with the radio off. Deliberately generic: per-entity read models are
 * Phase 3 work, and the mutation log stays the source of truth either way.
 */
export const localRecordSchema = z
  .object({
    key: z.string(), // `${entity}:${targetId}`
    entity: z.string(),
    targetId: z.string(),
    value: z.unknown(),
    updatedAt: z.number().int(),
    deleted: z.boolean(),
  })
  .strict();

export type LocalRecord = z.infer<typeof localRecordSchema>;

export function recordKey(entity: string, targetId: string): string {
  return `${entity}:${targetId}`;
}

/**
 * A row that could not be parsed back out of storage.
 *
 * Corruption must not be able to wedge the queue: one unreadable row would
 * otherwise fail every flush, and the whole outbox behind it would stop
 * moving. Quarantined rows keep their raw value so nothing is silently
 * dropped and the count is visible in diagnostics.
 */
export const quarantinedSchema = z
  .object({
    key: z.string(),
    store: z.string(),
    raw: z.unknown(),
    reason: z.string(),
    quarantinedAt: z.number().int(),
  })
  .strict();

export type Quarantined = z.infer<typeof quarantinedSchema>;

/** Meta keys. Each is parsed with its own schema on read. */
export const META = {
  deviceId: 'deviceId',
  nextClientSeq: 'nextClientSeq',
  clearedCount: 'clearedCount',
  lastSyncAt: 'lastSyncAt',
  pulledThrough: 'pulledThrough',
  pulledThroughId: 'pulledThroughId',
  lastError: 'lastError',
  persistGranted: 'persistGranted',
  syncHeld: 'syncHeld',
  lastBackupAt: 'lastBackupAt',
  readAlerts: 'readAlerts',
  sessionEnd: 'sessionEnd',
} as const;

export const metaSchemas = {
  deviceId: z.uuid(),
  /** Also the total ever enqueued: seq starts at 0 and increments once per enqueue. */
  nextClientSeq: z.number().int().nonnegative(),
  /** Mutations the server confirmed applied or duplicate, and which were removed. */
  clearedCount: z.number().int().nonnegative(),
  lastSyncAt: z.number().int(),
  /** serverTs watermark for hydration — how far this device has caught up. */
  pulledThrough: z.number().int(),
  /** The ULID half of that watermark. Breaks ties inside a single millisecond. */
  pulledThroughId: z.string().length(26),
  lastError: z.string(),
  persistGranted: z.boolean(),
  /**
   * Why the server is not taking this farm's work, when it is not (D13).
   *
   * Persisted rather than held in memory so the chip is right on the first
   * frame after a cold start. An in-memory flag would leave a free-tier farm
   * reading "340 waiting" every morning until the first flush corrected it —
   * and "waiting" is precisely the lie this state exists to stop telling.
   *
   * A `meta` key rather than a column, because it is one small fact about the
   * device's relationship with the server, which is what `meta` is for.
   */
  syncHeld: z.enum(SYNC_REFUSALS),
  /**
   * Official weather alerts this device has been told about, by service id.
   *
   * ## Why this exists after the refusal beside it
   *
   * `WeatherWarnings` refuses dismissal in four sentences and every one still
   * holds. This is not dismissal. An acknowledged alert stays on Today, stays
   * tappable, and still carries its full text — it collapses to a single line
   * instead of a card. Nothing is hidden and nothing is silenced.
   *
   * That distinction is what makes device-local storage acceptable here. A
   * second phone showing the card at full size is correct: that phone has not
   * been told. A reinstall forgetting is correct for the same reason. Both
   * would be unacceptable if the effect were silence, and are fine when the
   * effect is a smaller row.
   *
   * **Keyed by the service's own alert id**, which is the part that stops this
   * becoming the completion flag the due engine refuses. A farm cannot
   * acknowledge "heat" in general; it acknowledges one product, and when the
   * service issues a new one — an upgrade from watch to warning, a fresh
   * warning tomorrow — that is a new id and it arrives loud. The reflex that
   * taps things away cannot reach next week's tornado.
   *
   * Ids of alerts no longer in force are dropped when the list is written, so
   * this cannot grow without bound.
   */
  readAlerts: z.array(z.string().max(300)).max(200),
  /**
   * When a backup file was last written from this device.
   *
   * Stored because it is the only honest way to stop telling a farm its
   * records are in one place: it has *done* something about it. The
   * alternative — a dismiss button — stores "I saw this", which is the
   * completion flag the due engine refuses (property 3) and drifts from what
   * it describes the moment anything changes.
   *
   * A moment rather than a boolean, because a copy taken last spring is not
   * protection and a notice that never came back would be a promise this
   * cannot keep.
   */
  lastBackupAt: z.number().int(),
  /**
   * Why this device stopped being signed in, and when.
   *
   * **Recorded because "it makes me sign in again" was reported four times and
   * diagnosed by guesswork three of them.** Each guess was a real defect and
   * each fix was right, and the report kept coming back — because nothing on
   * the device could tell the difference between the causes. A refresh refused
   * by the server, a token that was never there, and a session ended
   * deliberately all leave a device at the sign-in screen with nothing to say.
   *
   * `at` is when it happened. `reason` is which of the three it was, and
   * `detail` carries the server's own sentence when there is one — never
   * invented here, and never the token, which is a credential and does not go
   * in a table somebody screenshots.
   */
  sessionEnd: z
    .object({
      at: z.number().int(),
      reason: z.enum(['refused', 'no-token', 'signed-out']),
      detail: z.string().max(200).optional(),
    })
    .strict(),
} as const;

/**
 * Parses a meta value, returning undefined when absent or unreadable.
 *
 * Callers decide what an unreadable value means: regenerating a corrupt
 * deviceId is fine, but falling back to zero for nextClientSeq would reuse
 * sequence numbers, so that caller derives a safe floor from the outbox
 * instead.
 */
export function parseMeta<K extends keyof typeof metaSchemas>(
  key: K,
  raw: unknown,
): z.infer<(typeof metaSchemas)[K]> | undefined {
  if (raw === undefined) return undefined;
  const parsed = metaSchemas[key].safeParse(raw);
  return parsed.success ? (parsed.data as z.infer<(typeof metaSchemas)[K]>) : undefined;
}
