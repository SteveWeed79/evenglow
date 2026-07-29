import { z } from 'zod';

/**
 * The sync envelope. Shared verbatim by client and server — this file is the
 * single source of truth for what a queued mutation looks like on the wire,
 * in IndexedDB, and in the `mutations` collection.
 */

export const MUTATION_SCHEMA_VERSION = 1;

/** Hard cap per batch. The server rejects anything larger outright. */
export const MAX_BATCH_SIZE = 100;

/**
 * Widening this list is additive and does not bump MUTATION_SCHEMA_VERSION.
 *
 * The envelope shape is unchanged, and an old client simply never sends a new
 * entity. The one ordering constraint is that the server must ship before a
 * client that emits a new value, since an old server answers 400 for an
 * entity it does not know — which is the correct, visible failure rather than
 * a silent drop.
 */
export const ENTITIES = [
  'flock',
  'animal',
  'medication',
  'eggLog',
  'productionLog',
  'feedLog',
  'mortality',
  'predator',
  'equipment',
  'hourReading',
  'maintenance',
  'task',
  'inventory',
  'photo',

  // Growing (docs/DOMAIN-SCOPE.md). Additive, so the envelope version is
  // unchanged and an old client simply never sends one.
  'site',
  'bed',
  'variety',
  'planting',
  'harvest',

  // The animal half completed: births, hatches, growth, fleeces, rations.
  'breeding',
  'incubation',
  'weight',
  'shearing',
  'feedPlan',
  'careLog',

  /**
   * A note left on any of them — the answer to "can two people on a farm talk
   * to each other in here". See `entities/notes.ts` for why it is a note on a
   * thing rather than a chat.
   */
  'note',
] as const;

export const entitySchema = z.enum(ENTITIES);
export type Entity = z.infer<typeof entitySchema>;

export const OPS = ['create', 'update', 'delete'] as const;
export const opSchema = z.enum(OPS);
export type Op = z.infer<typeof opSchema>;

/**
 * Append-only entities (D3). Immutable observations cannot conflict, so sync
 * for these is insert-if-absent. An update or delete targeting one is a 400,
 * not a no-op — silently accepting it would hide a client bug.
 */
export const APPEND_ONLY_ENTITIES = new Set<Entity>([
  'eggLog',
  'productionLog',
  'feedLog',
  'mortality',
  'predator',
  'hourReading',
  'harvest',
  'weight',
  'shearing',
  'careLog',
  'note',
]);

export function isAppendOnly(entity: Entity): boolean {
  return APPEND_ONLY_ENTITIES.has(entity);
}

/**
 * Crockford base32, 26 chars, no I/L/O/U. Length alone would accept a string
 * of 26 spaces, which then becomes an _id.
 *
 * Note: this validates format only. ID guessability is explicitly not a
 * security control (D5) — authorization is org + role scoping.
 */
export const ULID_PATTERN = /^[0-7][0-9ABCDEFGHJKMNPQRSTVWXYZ]{25}$/;

export const ulidSchema = z.string().length(26).regex(ULID_PATTERN, 'Not a valid ULID');

export const mutationSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    /** Idempotency key; becomes the `mutations` document _id. */
    id: ulidSchema,
    /** Entity id, minted offline on the client (D1). */
    targetId: ulidSchema,
    entity: entitySchema,
    op: opSchema,
    /** Validated per-entity in server/sync — see contracts/entities. */
    payload: z.unknown(),
    deviceId: z.uuid(),
    clientSeq: z.number().int().nonnegative(),
    /** Recorded, NOT trusted (D6). Ordering uses clientSeq and serverTs. */
    clientTs: z.number().int(),
  })
  .strict();

export type Mutation = z.infer<typeof mutationSchema>;

/**
 * `.strict()` is doing security work here, not tidiness: a payload-supplied
 * `orgId` must be a hard 400, never a silently ignored field (C2).
 */
export const syncRequestSchema = z
  .object({
    mutations: z.array(mutationSchema).min(1).max(MAX_BATCH_SIZE),
  })
  .strict();

export type SyncRequest = z.infer<typeof syncRequestSchema>;

export const MUTATION_STATUSES = ['applied', 'duplicate', 'rejected', 'conflict'] as const;
export type MutationStatus = (typeof MUTATION_STATUSES)[number];

export interface MutationResult {
  id: string;
  status: MutationStatus;
  /** Present on rejected/conflict. Plain and literal — it is shown to a user. */
  reason?: string;
}

export interface SyncResponse {
  results: MutationResult[];
  serverTs: number;
}

// ── Pull ─────────────────────────────────────────────────────────────────────

/** Page size for hydration. Kept modest so a cold device streams rather than stalls. */
export const PULL_PAGE_SIZE = 200;

/**
 * A mutation as it comes back from the server, carrying the global ordering
 * stamp. `serverTs` is the watermark a device pages through — clientTs is not
 * usable for this, since it comes from clocks we do not trust (D6).
 */
export const pulledMutationSchema = mutationSchema.extend({
  serverTs: z.number().int(),
});

export type PulledMutation = z.infer<typeof pulledMutationSchema>;

/**
 * The hydration cursor is a PAIR, and it has to be.
 *
 * `serverTs` is millisecond-resolution and a batch applies in a tight
 * sequential loop, so many mutations legitimately share a timestamp. Paging on
 * the timestamp alone means a page boundary landing inside a same-millisecond
 * group loses every row after the cut: the next request asks for `> that ms`
 * and those rows are never offered again. Silent, permanent, and only visible
 * after a reinstall.
 *
 * `_id` is a ULID, so it sorts lexicographically and breaks the tie with a
 * total order the server can seek into.
 */
export const pullResponseSchema = z
  .object({
    mutations: z.array(pulledMutationSchema),
    /** Send this back as `since` next time. */
    through: z.number().int(),
    /** Send this back as `sinceId`. Null only before the first row is ever read. */
    throughId: z.string().length(26).nullable(),
    /** True when more remain beyond this page. */
    more: z.boolean(),
  })
  .strict();

export type PullResponse = z.infer<typeof pullResponseSchema>;
