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
  'eggLog',
  'productionLog',
  'feedLog',
  'mortality',
  'predator',
  'equipment',
  'hourReading',
  'maintenance',
  'task',
  'photo',
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
