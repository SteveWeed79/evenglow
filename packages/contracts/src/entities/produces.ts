import { type FlockPurpose, SPECIES_TRAITS, type Species } from './livestock';

/**
 * What a group actually produces — capability AND intent, not either alone.
 *
 * ## The bug this exists to end
 *
 * Today decided what to offer with `laysEggs(group.species)`. Chickens lay
 * eggs, so a group named "Meat Birds" kept purely for the freezer got a full
 * egg tally every morning, forever, that nobody would ever put a number into.
 * Meanwhile a dairy goat keeper — whose entire morning is milking — got
 * nothing at all, because milk was never on Today in the first place.
 *
 * Both halves were already in the model and only one was being read:
 *
 * - **`SPECIES_TRAITS` is capability.** What this kind of animal *can* give.
 *   A chicken can lay; a cow cannot.
 * - **`purposes` is intent.** What the keeper says they are *for*. It is the
 *   only way somebody can say "these are for meat" and be believed.
 *
 * What a group produces is the intersection. Capability without intent offers
 * a tally nobody wants; intent without capability offers one nobody can fill.
 *
 * ## Production and processing are different questions
 *
 * A keeper's own framing, and it is a better one than a flat list of purposes:
 *
 * - **Production** is collected again and again from a living animal — eggs,
 *   milk, fibre. It recurs, so it belongs on Today.
 * - **Processing** happens once and ends the animal — meat. It is a date, not
 *   a tally, and it is already handled by the grow-out clock.
 *
 * **A group can be both, and that is the ordinary case rather than the edge.**
 * Black Australorp chicks raised for eggs and then for the table are one group
 * with both purposes: they produce eggs the whole time and reach a processing
 * weight once. Nothing here forces a choice between them.
 */

export const PRODUCTS = ['eggs', 'milk', 'fibre'] as const;
export type Product = (typeof PRODUCTS)[number];

/** Whether the species could give this at all, before anyone's intent. */
export function canProduce(species: Species, product: Product): boolean {
  const traits = SPECIES_TRAITS[species];
  switch (product) {
    case 'eggs':
      return traits.laysEggs;
    case 'milk':
      return traits.givesMilk;
    case 'fibre':
      return traits.givesFibre;
  }
}

/** The purpose that has to be set before a product is offered. */
const INTENT: Record<Product, FlockPurpose> = {
  eggs: 'eggs',
  milk: 'milk',
  fibre: 'fibre',
};

/**
 * What this group produces.
 *
 * **An empty purpose list means everything the species can do**, and that is
 * deliberate rather than a shortcut. A farm that has not answered the question
 * yet should see its options, not a blank Today — the first morning with the
 * app has to be useful. Once somebody says what a group is for, they are
 * believed, and a meat-only flock stops being asked about eggs.
 */
export function productsOf(species: Species, purposes: readonly string[] = []): Product[] {
  const chosen = purposes.length === 0 ? null : new Set(purposes);

  return PRODUCTS.filter(
    (product) => canProduce(species, product) && (chosen === null || chosen.has(INTENT[product])),
  );
}

/**
 * The ones collected daily, which is what earns a place on Today.
 *
 * Fibre is the exception and the reason this list exists separately: a fleece
 * comes off once or twice a year, so a wool tally on Today would be a row that
 * is wrong for 363 mornings. Shearing is recorded on the group, where an
 * annual job belongs.
 */
export const DAILY_PRODUCTS: readonly Product[] = ['eggs', 'milk'];

export function dailyProductsOf(species: Species, purposes: readonly string[] = []): Product[] {
  return productsOf(species, purposes).filter((p) => DAILY_PRODUCTS.includes(p));
}

/** Whether this group is grown for the table. Drives the processing clock. */
export function isProcessed(purposes: readonly string[] = []): boolean {
  return purposes.includes('meat');
}

// ── how the purposes read to a person ────────────────────────────────────────

/**
 * The three questions behind eight purposes.
 *
 * Eight chips in a row is a list to be read; three labelled groups is a
 * question to be answered. The grouping is the keeper's own — what do they
 * give you, are they for the table, what else are they here for — and it makes
 * the "both" case visibly available rather than something you have to realise
 * is allowed.
 */
export const PURPOSE_GROUPS = [
  {
    key: 'production',
    title: 'What do they give you?',
    hint: 'Collected again and again. These are what appear on Today.',
    purposes: ['eggs', 'milk', 'fibre'],
  },
  {
    key: 'processing',
    title: 'Are they for the table?',
    hint: 'Happens once. This is what starts the grow-out countdown.',
    purposes: ['meat'],
  },
  {
    key: 'other',
    title: 'Anything else?',
    hint: 'Neither collected nor processed — but still worth recording.',
    purposes: ['breeding', 'work', 'guarding', 'companion'],
  },
] as const satisfies readonly {
  key: string;
  title: string;
  hint: string;
  purposes: readonly FlockPurpose[];
}[];
