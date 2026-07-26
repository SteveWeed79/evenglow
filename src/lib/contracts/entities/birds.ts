import { z } from 'zod';

/** Multi-species from the schema up (P10) — not a chicken app with species bolted on. */
export const SPECIES = ['chicken', 'duck', 'quail', 'turkey', 'goose', 'other'] as const;
export const speciesSchema = z.enum(SPECIES);
export type Species = z.infer<typeof speciesSchema>;

/**
 * Fields every append-only observation carries. `occurredAt` is domain data —
 * when the thing happened, as the user reports it — and is distinct from the
 * envelope's `clientTs`, which is transport metadata. Neither is trusted for
 * ordering (D6); both are recorded.
 */
const observation = {
  occurredAt: z.number().int(),
  note: z.string().max(500).optional(),
};

// ── flock (mutable) ──────────────────────────────────────────────────────────

const flockShape = {
  name: z.string().min(1).max(80),
  species: speciesSchema,
  breed: z.string().max(80).optional(),
  count: z.number().int().nonnegative(),
  acquiredAt: z.number().int().optional(),
  note: z.string().max(500).optional(),
};

export const flockCreateSchema = z.object(flockShape).strict();
export const flockUpdateSchema = z.object(flockShape).partial().strict();

// ── eggLog (append-only) ─────────────────────────────────────────────────────

/**
 * Logged by flock OR by individual bird (P2). Exactly one subject, enforced
 * here rather than in the applier so the client cannot queue an unresolvable
 * record while offline.
 */
export const eggLogCreateSchema = z
  .object({
    ...observation,
    flockId: z.string().length(26).optional(),
    birdId: z.string().length(26).optional(),
    count: z.number().int().nonnegative().max(10_000),
    /** Set when the user logged through an active withdrawal warning (W2). */
    withdrawalAcknowledged: z.boolean().optional(),
  })
  .strict()
  .refine((v) => (v.flockId === undefined) !== (v.birdId === undefined), {
    message: 'An egg log needs exactly one of flockId or birdId.',
  });

// ── feedLog (append-only) ────────────────────────────────────────────────────

export const feedLogCreateSchema = z
  .object({
    ...observation,
    flockId: z.string().length(26),
    /** Grams. Integer units avoid float drift accumulating over a season. */
    amountGrams: z.number().int().positive(),
    feedType: z.string().max(80).optional(),
  })
  .strict();

// ── mortality (append-only) ──────────────────────────────────────────────────

export const MORTALITY_CAUSES = [
  'predator',
  'illness',
  'injury',
  'age',
  'cull',
  'unknown',
  'other',
] as const;

export const mortalityCreateSchema = z
  .object({
    ...observation,
    flockId: z.string().length(26),
    birdId: z.string().length(26).optional(),
    count: z.number().int().positive(),
    cause: z.enum(MORTALITY_CAUSES),
    /** Cull weights feed meat-yield math — an open request in competitor reviews. */
    cullWeightGrams: z.number().int().positive().optional(),
  })
  .strict();

// ── predator (append-only) ───────────────────────────────────────────────────

export const predatorCreateSchema = z
  .object({
    ...observation,
    species: z.string().max(80),
    /** Losses attributed to this sighting; zero is a legitimate "saw it, lost nothing". */
    lossCount: z.number().int().nonnegative().default(0),
    location: z.string().max(120).optional(),
  })
  .strict();
