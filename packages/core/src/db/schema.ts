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
const LOCAL_STATUSES = ['queued', 'sending', 'rejected'] as const;

/**
 * A mutation in the outbox: the wire envelope plus local bookkeeping.
 *
 * A record leaves this store in exactly one way — the server reported it
 * applied or duplicate. Rejections flip status and stay (A6), so "never drop
 * a rejected mutation" is a property of the storage layer rather than a rule
 * the flush loop has to remember.
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
