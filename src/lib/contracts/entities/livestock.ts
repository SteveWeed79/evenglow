import { z } from 'zod';

/**
 * Multi-species from the schema up (P10).
 *
 * Smallholdings are mixed. The same person keeps hens, a couple of goats, and
 * a steer, and a product that models only poultry makes two thirds of their
 * animals invisible. Poultry gets the deepest features because that is where
 * the competitive wedge is, not because it is the only thing here.
 *
 * `other` exists because this list will always be incomplete — yaks, water
 * buffalo, guinea pigs — and is paired with a free-text `speciesOther`.
 */
export const SPECIES = [
  // Poultry
  'chicken',
  'duck',
  'goose',
  'turkey',
  'quail',
  'guineafowl',
  'pigeon',
  // Ratites — kept apart from poultry because the scale is entirely different
  'emu',
  'ostrich',
  'rhea',
  // Ruminants and camelids
  'goat',
  'sheep',
  'cattle',
  'alpaca',
  'llama',
  // Other common smallholding stock
  'pig',
  'rabbit',
  'donkey',
  'horse',
  'other',
] as const;

export const speciesSchema = z.enum(SPECIES);
export type Species = z.infer<typeof speciesSchema>;

export type SpeciesGroup = 'poultry' | 'ratite' | 'ruminant' | 'other';

export interface SpeciesTraits {
  label: string;
  /**
   * What a group of them is called. A cattle keeper reading "flock" learns
   * the app was not built for them, and the voice rule is that names are ones
   * people recognise (UX-SPEC §6).
   */
  collective: string;
  /** Drives whether egg logging is offered at all. */
  laysEggs: boolean;
  group: SpeciesGroup;
}

export const SPECIES_TRAITS: Record<Species, SpeciesTraits> = {
  chicken: { label: 'Chickens', collective: 'flock', laysEggs: true, group: 'poultry' },
  duck: { label: 'Ducks', collective: 'flock', laysEggs: true, group: 'poultry' },
  goose: { label: 'Geese', collective: 'gaggle', laysEggs: true, group: 'poultry' },
  turkey: { label: 'Turkeys', collective: 'flock', laysEggs: true, group: 'poultry' },
  quail: { label: 'Quail', collective: 'covey', laysEggs: true, group: 'poultry' },
  guineafowl: { label: 'Guinea fowl', collective: 'flock', laysEggs: true, group: 'poultry' },
  pigeon: { label: 'Pigeons', collective: 'loft', laysEggs: true, group: 'poultry' },

  emu: { label: 'Emu', collective: 'mob', laysEggs: true, group: 'ratite' },
  ostrich: { label: 'Ostrich', collective: 'flock', laysEggs: true, group: 'ratite' },
  rhea: { label: 'Rhea', collective: 'flock', laysEggs: true, group: 'ratite' },

  goat: { label: 'Goats', collective: 'herd', laysEggs: false, group: 'ruminant' },
  sheep: { label: 'Sheep', collective: 'flock', laysEggs: false, group: 'ruminant' },
  cattle: { label: 'Cattle', collective: 'herd', laysEggs: false, group: 'ruminant' },
  alpaca: { label: 'Alpacas', collective: 'herd', laysEggs: false, group: 'ruminant' },
  llama: { label: 'Llamas', collective: 'herd', laysEggs: false, group: 'ruminant' },

  pig: { label: 'Pigs', collective: 'drove', laysEggs: false, group: 'other' },
  rabbit: { label: 'Rabbits', collective: 'colony', laysEggs: false, group: 'other' },
  donkey: { label: 'Donkeys', collective: 'herd', laysEggs: false, group: 'other' },
  horse: { label: 'Horses', collective: 'herd', laysEggs: false, group: 'other' },

  other: { label: 'Other', collective: 'group', laysEggs: true, group: 'other' },
};

/** The word for a group of this species — "herd", "flock", "drove". */
export function collectiveNoun(species: Species): string {
  return SPECIES_TRAITS[species].collective;
}

/**
 * Whether to offer egg logging. `other` returns true: an unknown species is
 * more likely to be a bird we did not list than a mammal, and refusing to
 * record something the user is holding in their hand is the worse failure.
 */
export function laysEggs(species: Species): boolean {
  return SPECIES_TRAITS[species].laysEggs;
}

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

/**
 * A group of animals. `flock` is the wire name, fixed by the entity enum in
 * CLAUDE.md; the UI says herd, drove, or gaggle according to the species (see
 * collectiveNoun). Renaming the entity itself would be a schema-version break
 * for no user-visible gain, since nobody reads the wire format.
 *
 * `count` is head count for every species — birds, goats, cattle alike.
 */
const flockShape = {
  name: z.string().min(1).max(80),
  species: speciesSchema,
  /** Required in spirit when species is 'other'; free text, since the list will never be complete. */
  speciesOther: z.string().max(80).optional(),
  breed: z.string().max(80).optional(),
  count: z.number().int().nonnegative(),
  acquiredAt: z.number().int().optional(),
  note: z.string().max(500).optional(),
};

export const flockCreateSchema = z.object(flockShape).strict();
export const flockUpdateSchema = z.object(flockShape).partial().strict();

// ── eggLog (append-only) ─────────────────────────────────────────────────────

/**
 * Logged by group OR by individual bird (P2). Exactly one subject, enforced
 * here rather than in the applier so the client cannot queue an unresolvable
 * record while offline.
 *
 * `birdId` rather than `animalId` on purpose: only birds lay eggs, so a
 * broader name here would suggest a capability that does not exist.
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

// ── animal (mutable) ─────────────────────────────────────────────────────────

/**
 * An individual animal within a group (parity floor P1/P2).
 *
 * Archived, never deleted (P13): a hen's laying record and a doe's kidding
 * history are the reason the record exists, and deleting the animal would
 * take them with it.
 */
const animalShape = {
  flockId: z.string().length(26),
  name: z.string().min(1).max(80),
  species: speciesSchema,
  breed: z.string().max(80).optional(),
  sex: z.enum(['female', 'male', 'unknown']).optional(),
  /** Hatched, or born — one field, since the distinction is the species'. */
  bornAt: z.number().int().optional(),
  /** Leg band, ear tag, or ear notch. */
  tag: z.string().max(40).optional(),
  traits: z.array(z.string().max(40)).max(20).optional(),
  weightGrams: z.number().int().positive().optional(),
  note: z.string().max(500).optional(),
};

export const animalCreateSchema = z.object(animalShape).strict();
export const animalUpdateSchema = z.object(animalShape).partial().strict();

// ── productionLog (append-only) ──────────────────────────────────────────────

/**
 * Non-egg produce: milk, fibre, honey.
 *
 * Eggs keep their own entity because they were modelled first and carry the
 * withdrawal interlock (W2); this covers everything else a smallholding takes
 * off its animals. Without it, ruminant support would be head count and
 * mortality only, which is not support.
 *
 * Out of scope, deliberately: creamery workflows, milk testing, and anything
 * resembling dairy processing. This records a volume, not a supply chain.
 */
export const PRODUCE_KINDS = ['milk', 'fibre', 'honey', 'other'] as const;

export const productionLogCreateSchema = z
  .object({
    ...observation,
    flockId: z.string().length(26).optional(),
    animalId: z.string().length(26).optional(),
    kind: z.enum(PRODUCE_KINDS),
    /** Millilitres for milk, grams for fibre and honey. Integers avoid drift. */
    amount: z.number().int().positive().max(10_000_000),
    unit: z.enum(['ml', 'g']),
    /** Names the produce when kind is 'other'. */
    label: z.string().max(80).optional(),
    /** Set when logged through an active medication withdrawal (W2). */
    withdrawalAcknowledged: z.boolean().optional(),
  })
  .strict()
  .refine((v) => (v.flockId === undefined) !== (v.animalId === undefined), {
    message: 'A production log needs exactly one of flockId or animalId.',
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
    /** `animalId`, not `birdId`: goats and cattle die too. */
    animalId: z.string().length(26).optional(),
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
