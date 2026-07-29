import { z } from 'zod';
import type { PLANT_FAMILIES, LIFECYCLES } from '../entities/growing';

/**
 * The bundled reference library.
 *
 * About forty breeds and sixty varieties ship with the app so a new farm is
 * useful on the first evening rather than after one. Every number here is a
 * **starting point that a farm overrides**, and the override always wins — a
 * grower who knows their Sungold ripens ten days earlier than the packet says
 * must be able to say so, and the app must then believe them.
 *
 * ## Where these numbers come from, stated honestly
 *
 * They are the commonly published figures: what breed associations, seed
 * catalogues and land-grant extension guides broadly agree on, assembled here
 * with our own structure. They are **not** transcribed from any single
 * compilation, and specifically not from commercial breeding companies'
 * performance objectives — those are the most precise figures available and
 * the most legally fraught, and `docs/BREED-AND-PURPOSE.md` §5 leaves their
 * licensing as an open question that has not been answered.
 *
 * `provenance` records that honestly rather than implying a citation nobody
 * checked. When sourced data with real per-field provenance arrives, this
 * field is where it goes.
 *
 * ## Ranges for breeds, points for varieties
 *
 * Not an inconsistency. A breed's grow-out is genuinely a range — "eight to
 * nine weeks" is true, "eight weeks" is a claim about a specific bird on
 * specific feed — and `BREED-AND-PURPOSE.md` is explicit that a single number
 * implies a precision nobody has.
 *
 * A named cultivar's days-to-maturity is a point because that is what the
 * packet says and what the grower will compare against. The variation there
 * lives between cultivars, which is why they are listed separately.
 *
 * ## Human units in, canonical units out
 *
 * Entries are authored in inches, pounds and kilogrammes because that is what
 * is checkable by eye against a catalogue. The factories that turn a library
 * entry into a record convert to the canonical bases. Nothing stores what is
 * written here verbatim.
 */

export const PROVENANCES = ['commonly-published', 'user'] as const;
export const provenanceSchema = z.enum(PROVENANCES);
export type Provenance = z.infer<typeof provenanceSchema>;

/** Inclusive, `[low, high]`. Equal ends mean the figure really is agreed. */
export type Range = readonly [number, number];

export const PURPOSES = [
  'eggs',
  'meat',
  'milk',
  'fibre',
  'breeding',
  'work',
  'guarding',
  'companion',
] as const;
export const purposeSchema = z.enum(PURPOSES);
export type Purpose = z.infer<typeof purposeSchema>;

export interface LibraryBreed {
  /** Stable slug. Referenced by farm records, so it must not change. */
  id: string;
  species: string;
  name: string;
  /** People type what they say: "Cornish X", "broiler". */
  aliases?: readonly string[];
  /**
   * Defaults used to prefill a group, never to constrain it.
   *
   * `breeding`, `guarding` and `companion` matter more than they look: they
   * are how a keeper says "do not show me a processing countdown for these"
   * without lying about the species.
   */
  purposes: readonly Purpose[];

  /** Weeks to processing weight. Meat breeds. */
  growOutWeeks?: Range;
  /** Weeks until first egg. Layers. */
  layOnsetWeeks?: Range;
  layRatePerYear?: Range;
  /** Mature weight in kilogrammes, by sex where the difference is real. */
  matureWeightKg?: { female: Range; male?: Range };
  /** Litres per day at peak. Dairy breeds. */
  milkLitresPerDay?: Range;
  /** Months between shearings. Fibre breeds. */
  fibreIntervalMonths?: number;
  provenance: Provenance;
  note?: string;
}

export interface LibraryVariety {
  id: string;
  /** The crop: 'Tomato'. `name` is the cultivar: 'Sungold'. */
  crop: string;
  name: string;
  family: (typeof PLANT_FAMILIES)[number];
  lifecycle: (typeof LIFECYCLES)[number];

  /** Coldest temperature it survives, °F. Perennials only, in practice. */
  hardyToF?: number;

  startIndoorsWeeksBefore?: number;
  transplantWeeksAfter?: number;
  directSowWeeksAfter?: number;
  autumnSowWeeksBefore?: number;
  daysToMaturity: number;

  spacingIn?: number;
  rowSpacingIn?: number;
  sowDepthIn?: number;
  successionDays?: number;

  provenance: Provenance;
  note?: string;
}
