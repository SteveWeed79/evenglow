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
 *
 * **That was true of what a client SENDS and false of what it reads, and the
 * gap bricked hydration.** Additive on the server means the feed starts
 * carrying the new entity immediately, to every device including the ones that
 * have not been upgraded. `pullResponseSchema` parsed the page as a unit
 * against the strict enum, so one unmodelable row failed the whole page,
 * `pull.ts` returned `deferred: 'unreadable'`, and the watermark never moved:
 * that install stopped receiving ANY of the farm's records — not just the new
 * kind — permanently, silently, behind a chip that said it was up to date. The
 * sentence above said this was fine.
 *
 * A client now reads rows one at a time and skips the ones it cannot model,
 * the way `readSnapshotPage` already does on the server. So the constraint
 * stands as written for sends, and for reads the answer is that an old client
 * misses the new entity and keeps everything else — which is what "additive"
 * was always supposed to mean.
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
  'stockAdjustment',
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
 * Append-only entities (D3): **immutable in value, removable in whole.**
 *
 * A record of these kinds is never edited. That is what append-only means and
 * it is what D3's two load-bearing reasons rest on — an observation's value
 * cannot change, so two devices cannot disagree about it, and sync stays
 * insert-if-absent. An `update` targeting one is a 400, not a no-op; silently
 * accepting it would hide a client bug.
 *
 * `delete` is allowed, and refusing it was a mistake. A delete archives —
 * `$set archivedAt` — which is repeatable, so deleting twice is deleting once,
 * so it cannot conflict either and none of the above changes. The only thing
 * the refusal bought was D3's third reason, a "free audit history", and that
 * reason does not survive being said out loud: nobody needs a paper trail
 * proving somebody once typed twelve eggs against the wrong flock at six in
 * the morning. It is a tally, not a controlled substance.
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
  'stockAdjustment',
]);

export function isAppendOnly(entity: Entity): boolean {
  return APPEND_ONLY_ENTITIES.has(entity);
}

/**
 * ## There is no permanent entity, and the hour meter was the argument
 *
 * This nearly shipped with `hourReading` exempted, on the reasoning that its
 * readings are a monotonic series every maintenance forecast is derived from,
 * so removing one from the middle silently widens the interval either side.
 * That much is true. The conclusion drawn from it was backwards.
 *
 * The advice that came with the exemption was "a mistyped reading is corrected
 * by recording the right one" — and the meter's own rule makes that impossible
 * in the case that matters. `decideHourReading` refuses any reading below the
 * highest recorded. Fat-finger 9999 hours onto a tractor that has done 999 and
 * every correct reading for the rest of that machine's life is refused. The
 * exemption did not protect the series; it made the one mistake that actually
 * breaks the series unfixable, and left the farm with a machine it could no
 * longer log.
 *
 * Losing a legitimate reading is a rounder forecast. Keeping a typo is a dead
 * hour meter. So every append-only record can be taken back, and the fix path
 * is load-bearing enough that `highestHours` on the server must ignore
 * archived readings — see `apps/api/src/sync/apply.ts`.
 *
 * Mutable entities were always archived rather than deleted (P13). This is
 * about the append-only ones, and the answer is the same for all of them.
 */

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
/**
 * A pulled row before this build has decided whether it can model it.
 *
 * The entity is a string here rather than the enum, and that one loosening is
 * the whole of the forward-compatibility fix. Everything else stays strict, so
 * a row that is genuinely malformed — a short ULID, a missing `serverTs` — is
 * still a parse failure and still loud. The two cases must not be confused: one
 * is a newer server doing exactly what it is allowed to do, the other is a bug
 * or a tampered response, and silently dropping the second is how a real defect
 * becomes invisible.
 */
export const pulledRowSchema = pulledMutationSchema.extend({
  entity: z.string().min(1).max(60),
});

export type PulledRow = z.infer<typeof pulledRowSchema>;

/**
 * The rows this build can model, and a count of the ones it cannot.
 *
 * Counted rather than merely dropped. "We skipped four records because this app
 * is older than the farm's server" is a fact somebody may need, and a silent
 * skip is the failure mode this whole item is about — one silence traded for
 * another would be no fix at all.
 */
export function readableRows(rows: readonly PulledRow[]): {
  known: PulledMutation[];
  unmodelable: number;
} {
  const known: PulledMutation[] = [];
  let unmodelable = 0;

  for (const row of rows) {
    const entity = entitySchema.safeParse(row.entity);
    if (entity.success) known.push({ ...row, entity: entity.data });
    else unmodelable += 1;
  }

  return { known, unmodelable };
}

export const pullResponseSchema = z
  .object({
    mutations: z.array(pulledRowSchema),
    /** Send this back as `since` next time. */
    through: z.number().int(),
    /** Send this back as `sinceId`. Null only before the first row is ever read. */
    throughId: z.string().length(26).nullable(),
    /** True when more remain beyond this page. */
    more: z.boolean(),
  })
  .strict();

export type PullResponse = z.infer<typeof pullResponseSchema>;

/**
 * What each entity is called to the person who typed it, rather than on the
 * wire.
 *
 * Server refusals reach a screen — "Your role cannot update a eggLog" was
 * shipped, and it is two mistakes in five words: a schema name a farmer has
 * never seen, behind the wrong article. Both come from building a sentence out
 * of an enum.
 *
 * Here rather than in the app because the sentence is built on the server and
 * read on the device, which is exactly what `contracts` is for. No articles —
 * a noun is usable in more sentences than "a noun" is, and `aOrAn` supplies
 * one where a sentence needs it.
 */
export const ENTITY_NOUNS: Record<Entity, string> = {
  flock: 'group',
  animal: 'animal',
  medication: 'treatment',
  eggLog: 'egg count',
  productionLog: 'production record',
  feedLog: 'feeding',
  mortality: 'loss',
  predator: 'predator sighting',
  equipment: 'machine',
  hourReading: 'hour reading',
  maintenance: 'service',
  task: 'job',
  inventory: 'shelf item',
  photo: 'photograph',
  site: 'ground',
  bed: 'bed',
  variety: 'variety',
  planting: 'planting',
  harvest: 'harvest',
  breeding: 'mating',
  incubation: 'set of eggs',
  stockAdjustment: 'shelf adjustment',
  weight: 'weight',
  shearing: 'shearing',
  feedPlan: 'ration',
  careLog: 'job done',
  note: 'note',
};

export function entityNoun(entity: Entity): string {
  return ENTITY_NOUNS[entity];
}

/** "an egg count", "a group". Vowel rule only — no word here needs more. */
export function aOrAn(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
}

/** What each op is called in a sentence, which is not what it is called in code. */
const OP_VERBS: Record<Op, string> = {
  create: 'record',
  update: 'change',
  delete: 'remove',
};

/**
 * The sentence a farmer reads when their role will not let them do something.
 *
 * Plain, specific, and no apology (UX-SPEC §6) — and no schema name, which is
 * the part that was actually wrong.
 */
export function roleRefusal(op: Op, entity: Entity): string {
  return `Your role cannot ${OP_VERBS[op]} ${aOrAn(entityNoun(entity))}.`;
}
