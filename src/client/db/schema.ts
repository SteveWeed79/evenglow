import { z } from 'zod';
import { mutationSchema } from '@/lib/contracts/mutation';

/**
 * IndexedDB schema for the offline engine.
 *
 * Everything read back out of IndexedDB is parsed through these schemas
 * (invariant 8). Storage is external data: it survives across app versions,
 * can be edited by hand in devtools, and can be corrupted by a failed
 * migration, so it is never trusted on the way in.
 */

export const DB_NAME = 'steading';

/**
 * Bumping this runs the migration ladder in open.ts. Migrations are additive
 * only — an append-only outbox must never be destructively migrated, which is
 * the cheap answer to the one failure mode a second local store would cover
 * (masterplan Q1).
 */
export const DB_VERSION = 1;

export const STORES = {
  outbox: 'outbox',
  records: 'records',
  meta: 'meta',
} as const;

/** Local lifecycle, distinct from the server's per-mutation result status. */
export const LOCAL_STATUSES = ['queued', 'sending', 'rejected'] as const;
export type LocalStatus = (typeof LOCAL_STATUSES)[number];

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

/** Meta keys. Each is parsed with its own schema on read. */
export const META = {
  deviceId: 'deviceId',
  nextClientSeq: 'nextClientSeq',
  clearedCount: 'clearedCount',
  lastSyncAt: 'lastSyncAt',
  pulledThrough: 'pulledThrough',
  lastError: 'lastError',
  persistGranted: 'persistGranted',
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
  lastError: z.string(),
  persistGranted: z.boolean(),
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
