import { z } from 'zod';
import { speciesSchema } from './livestock';
import { microgramsSchema } from '../units';

/**
 * Birthing and hatching — the part of the year a smallholding is planned
 * around, and the largest gap in the animal half until now.
 *
 * **Two entities, because they are genuinely different events.** A gestation
 * is one animal carrying one pregnancy to a date. An incubation is a batch of
 * eggs with a candling step partway through and a hatch rate at the end.
 * Forcing them into one shape would mean half the fields being meaningless in
 * either case, and a UI that had to branch on species everywhere anyway.
 *
 * The due builders for both already exist and are tested — `birthDue` and
 * `incubationDues` in `due/livestock.ts`. These are the records they read.
 */

// ── breeding (mutable) ───────────────────────────────────────────────────────

export const BREEDING_METHODS = ['natural', 'ai'] as const;
export const breedingMethodSchema = z.enum(BREEDING_METHODS);

/**
 * A mating, and eventually its outcome.
 *
 * Mutable because the outcome is filled in months later. The record exists
 * from the day of the mating so the due date can be counted from it — a
 * record created at birth would be a birth certificate, which is not what
 * anyone needs six weeks beforehand.
 */
const breedingShape = {
  species: speciesSchema,
  damId: z.string().length(26),
  /**
   * Optional, and that is not laziness. A buck borrowed for a fortnight often
   * has no record on this farm at all, and requiring one would mean either
   * inventing an animal or not recording the mating.
   */
  sireId: z.string().length(26).optional(),
  sireNote: z.string().max(120).optional(),

  bredAt: z.number().int(),
  method: breedingMethodSchema,

  /**
   * Overrides the species gestation when a vet has scanned or the keeper knows
   * better. Absent means the due date is computed, which is the normal case.
   */
  dueAtOverride: z.number().int().optional(),

  // The outcome. All absent until it happens.
  bornAt: z.number().int().optional(),
  liveBorn: z.number().int().min(0).max(30).optional(),
  stillborn: z.number().int().min(0).max(30).optional(),
  /**
   * Recorded as its own field rather than inferred from a zero live birth.
   * A pregnancy that did not go to term and a pregnancy that produced nothing
   * living are different events, and a keeper deciding whether to breed this
   * animal again needs to know which.
   */
  lost: z.boolean().optional(),

  note: z.string().max(1000).optional(),
};

export const breedingCreateSchema = z.object(breedingShape).strict();
export const breedingUpdateSchema = z.object(breedingShape).partial().strict();

// ── incubation (mutable) ─────────────────────────────────────────────────────

export const EGG_SOURCES = ['own', 'bought', 'gifted'] as const;
export const eggSourceSchema = z.enum(EGG_SOURCES);

export const INCUBATION_METHODS = ['incubator', 'broody'] as const;
export const incubationMethodSchema = z.enum(INCUBATION_METHODS);

/**
 * A set of eggs, from the day they go under.
 *
 * `candledAt` and `fertile` are the step that makes this worth recording at
 * all: culling clears around day seven is what frees space for the next set,
 * and a keeper who tracks fertility across sets learns something about their
 * birds that no single hatch tells them.
 */
const incubationShape = {
  species: speciesSchema,
  /** The group the eggs came from, when they came from this farm. */
  flockId: z.string().length(26).optional(),
  /**
   * What breed they are, when it is known.
   *
   * **Not because it changes the dates.** Incubation length is a property of
   * the species and hardly of the breed at all — every chicken breed is 21
   * days, and the half-day a bantam pips early is smaller than the swing an
   * incubator running a degree warm produces. A per-breed table here would be
   * inventing precision, which is the same mistake as naming one humidity
   * figure.
   *
   * It is here because of what comes **out**. The library knows when a Rhode
   * Island Red starts to lay and how fast it grows; without this, a hatch
   * produces chicks the app cannot say anything about, and the group made from
   * them starts blank. The eggs are the last moment somebody knows for certain
   * what they are.
   *
   * Optional, and it has to be: a bought set is often mixed, and own eggs from
   * a mixed flock are honestly unknown. Absent means "not said".
   */
  breedId: z.string().min(1).max(80).optional(),
  label: z.string().min(1).max(80),

  setAt: z.number().int(),
  eggsSet: z.number().int().min(1).max(10_000),
  source: eggSourceSchema,
  method: incubationMethodSchema,

  // Candling, roughly a third of the way through.
  candledAt: z.number().int().optional(),
  fertile: z.number().int().min(0).max(10_000).optional(),

  // The hatch.
  hatchedAt: z.number().int().optional(),
  hatched: z.number().int().min(0).max(10_000).optional(),
  /**
   * Chicks that hatched and did not survive the first days. Separate from
   * `hatched` because hatch rate and survival rate are different numbers, and
   * a keeper diagnosing a bad set needs to know which one moved.
   */
  earlyLosses: z.number().int().min(0).max(10_000).optional(),

  note: z.string().max(1000).optional(),
};

export const incubationCreateSchema = z.object(incubationShape).strict();
export const incubationUpdateSchema = z.object(incubationShape).partial().strict();

// ── weight (append-only) ─────────────────────────────────────────────────────

/**
 * A weighing. Append-only, like every other observation.
 *
 * A growth curve is how a keeper knows a meat bird is on track before the
 * processing date arrives, and how they know a doe is losing condition before
 * it is visible. One number on its own says almost nothing; the series says
 * everything, which is why these are never overwritten.
 *
 * `animal.weightGrams` stays as the last known weight for display. This is
 * the history behind it.
 */
export const weightCreateSchema = z
  .object({
    occurredAt: z.number().int(),
    animalId: z.string().length(26).optional(),
    flockId: z.string().length(26).optional(),
    massUg: microgramsSchema,
    /**
     * True when the figure is a group average rather than one animal on a
     * scale — the normal case for a pen of forty birds. Recorded so a growth
     * curve is never plotted as if it were an individual.
     */
    sampled: z.boolean().optional(),
    note: z.string().max(300).optional(),
  })
  .strict()
  .refine((w) => (w.animalId === undefined) !== (w.flockId === undefined), {
    message: 'A weight belongs to exactly one animal or one group',
  });

// ── shearing (append-only) ───────────────────────────────────────────────────

/**
 * A fleece off.
 *
 * Fibre is annual or twice-annual with a weight, not a daily tally, which is
 * why it is not a `productionLog`. Recording it here is also what closes the
 * shearing due row — the interval counts from the last one.
 */
export const shearingCreateSchema = z
  .object({
    occurredAt: z.number().int(),
    animalId: z.string().length(26).optional(),
    flockId: z.string().length(26).optional(),
    /** Greasy weight, as it comes off. Skirted weight is a later number. */
    massUg: microgramsSchema,
    /** Animals shorn, when the record covers a group. */
    animalsShorn: z.number().int().min(1).max(10_000).optional(),
    note: z.string().max(300).optional(),
  })
  .strict()
  .refine((s) => (s.animalId === undefined) !== (s.flockId === undefined), {
    message: 'A shearing belongs to exactly one animal or one group',
  });

// ── feedPlan (mutable) ───────────────────────────────────────────────────────

/**
 * What a group *should* be fed, as distinct from what it was.
 *
 * `feedLog` records the second. Without the first there is nothing to check
 * consumption against, so a bag running out is discovered rather than
 * predicted — and "order feed" is exactly the kind of thing that should
 * arrive as a due row rather than as a surprise on a Sunday.
 *
 * Mutable: a ration changes with the season, with age, and with what the feed
 * store had in.
 */
const feedPlanShape = {
  flockId: z.string().length(26),
  feedName: z.string().min(1).max(80),
  /** Per animal per day. Multiplied by head count to predict the bag. */
  perAnimalPerDayUg: microgramsSchema,
  startedAt: z.number().int(),
  /** Absent means current. Set when the ration is superseded. */
  endedAt: z.number().int().optional(),
  note: z.string().max(500).optional(),
};

export const feedPlanCreateSchema = z.object(feedPlanShape).strict();
export const feedPlanUpdateSchema = z.object(feedPlanShape).partial().strict();
