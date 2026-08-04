import { z } from 'zod';

/**
 * Units.
 *
 * **Imperial is the default and metric is one switch away, but neither is what
 * gets stored.** Every measurement crosses the wire and hits SQLite as an
 * integer in a canonical base unit, and is converted only at the edge where a
 * human reads or types it.
 *
 * Two reasons, and the second is the load-bearing one:
 *
 * 1. A farm that switches display units must not rewrite its history. Storing
 *    what was typed means "4 lb" and "1.81 kg" are different rows describing
 *    the same egg basket, and any sum over both is wrong.
 *
 * 2. **Integers, so nothing drifts.** Floating point cannot represent 0.1
 *    exactly; a running total of tenths accumulates error, and the place that
 *    surfaces is a medication dose or a withdrawal calculation. Base units are
 *    chosen fine enough that no real entry needs a fraction of one.
 *
 * The canonical units are metric because the base units are decimal, not
 * because metric is preferred. Nobody sees them.
 */

// ── the canonical bases ──────────────────────────────────────────────────────

/**
 * Length in micrometres. Spacing, sow depth, bed dimensions.
 *
 * Micrometres rather than millimetres because **one inch is exactly 25,400 of
 * them**, so every imperial entry stores exactly and comes back exactly. At
 * millimetre resolution a quarter-inch sow depth stored as 6 and read back as
 * 0.236", which is the app visibly disagreeing with the seed packet in front
 * of the person typing.
 */
export type Micrometres = number;

/**
 * Mass in micrograms. Harvest weights, animal weights, feed.
 *
 * Same reason: one pound is exactly 453,592,370 µg. At milligram resolution a
 * one-pound harvest read back as 0.99999918 lb and therefore displayed as
 * "16 oz", because the format rule asks whether it is at least a pound.
 *
 * A hundred tonnes still fits inside a safe integer, so the headroom is not a
 * concern at any scale a smallholding reaches.
 */
export type Micrograms = number;

/** Volume in microlitres. Fine enough that a 0.5 mL dose is 500, not 0.5. */
export type Microlitres = number;
/** Temperature in tenths of a degree Celsius. Frost thresholds, zone floors. */
export type DeciCelsius = number;

export const micrometresSchema = z.number().int();
export const microgramsSchema = z.number().int().nonnegative();
export const microlitresSchema = z.number().int().nonnegative();
export const deciCelsiusSchema = z.number().int();

// ── what a farm sees ─────────────────────────────────────────────────────────

export const UNIT_SYSTEMS = ['imperial', 'metric'] as const;
export const unitSystemSchema = z.enum(UNIT_SYSTEMS);
export type UnitSystem = z.infer<typeof unitSystemSchema>;

/**
 * Imperial, because USDA zones, US seed packets and US feed labels are what
 * the bundled reference data is drawn from, and a farm reading 12" on a packet
 * should see 12" in the app. One setting flips the whole app.
 */
export const DEFAULT_UNIT_SYSTEM: UnitSystem = 'imperial';

// ── conversion ───────────────────────────────────────────────────────────────

/** All three are exact by definition, which is the point of these bases. */
const UM_PER_INCH = 25_400;
const UG_PER_POUND = 453_592_370;
const UG_PER_OUNCE = UG_PER_POUND / 16;
const UL_PER_FLUID_OUNCE = 29_573.5295625;
/** US liquid, not imperial — the app's reference data is American throughout. */
const UL_PER_QUART = UL_PER_FLUID_OUNCE * 32;
const UL_PER_GALLON = UL_PER_FLUID_OUNCE * 128;

export function inchesToUm(inches: number): Micrometres {
  return Math.round(inches * UM_PER_INCH);
}

export function umToInches(um: Micrometres): number {
  return um / UM_PER_INCH;
}

export function mmToUm(mm: number): Micrometres {
  return Math.round(mm * 1000);
}

export function umToMm(um: Micrometres): number {
  return um / 1000;
}

export function poundsToUg(pounds: number): Micrograms {
  return Math.round(pounds * UG_PER_POUND);
}

export function ugToPounds(ug: Micrograms): number {
  return ug / UG_PER_POUND;
}

export function ouncesToUg(ounces: number): Micrograms {
  return Math.round(ounces * UG_PER_OUNCE);
}

export function ugToOunces(ug: Micrograms): number {
  return ug / UG_PER_OUNCE;
}

export function gramsToUg(grams: number): Micrograms {
  return Math.round(grams * 1_000_000);
}

/**
 * `productionLog` stores millilitres and grams rather than the finer bases,
 * because it was modelled before them and its rows are already synced.
 *
 * Both scalings are exact, so the coarser store loses nothing a farm can
 * type — a milking is not recorded to the microlitre. These exist so the
 * conversion is named at the edge instead of a bare `* 1000` in a screen.
 */
export function mlToUl(ml: number): Microlitres {
  return Math.round(ml * 1000);
}

export function fluidOuncesToUl(ounces: number): Microlitres {
  return Math.round(ounces * UL_PER_FLUID_OUNCE);
}

export function ulToFluidOunces(ul: Microlitres): number {
  return ul / UL_PER_FLUID_OUNCE;
}

export function fahrenheitToDeciC(f: number): DeciCelsius {
  return Math.round(((f - 32) * 5) / 9 * 10);
}

export function deciCToFahrenheit(dc: DeciCelsius): number {
  return (dc / 10) * 9 / 5 + 32;
}

// ── display ──────────────────────────────────────────────────────────────────

/**
 * One decimal place, and the trailing `.0` dropped.
 *
 * A seed packet says 12", not 12.0". Precision the farmer did not supply is
 * precision the app is inventing, and on a screen read at arm's length in a
 * field it is also just noise.
 */
function trim(value: number, places = 1): string {
  // `+` normalises -0 to 0. Without it, 0 °F round-trips to -0.04 °C and
  // formats as "-0°F", which reads as a bug to anyone who sees it.
  const fixed = (value + 0).toFixed(places);
  const trimmed = places === 0 ? fixed : fixed.replace(/\.0+$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}

export function formatLength(um: Micrometres, system: UnitSystem): string {
  if (system === 'metric') {
    const mm = umToMm(um);
    return mm >= 1000 ? `${trim(mm / 1000, 2)} m` : `${trim(mm / 10)} cm`;
  }
  const inches = umToInches(um);
  // Feet only past a yard; "38 in" is more use to someone with a tape than
  // "3.2 ft", and bed dimensions are the only place this gets large.
  return inches >= 36 ? `${trim(inches / 12)} ft` : `${trim(inches)} in`;
}

/**
 * A quantity and the unit it is in, kept apart.
 *
 * Today sets the number at tally size and the unit at label size beneath it,
 * so it needs the two separately. Splitting on the space in a formatted string
 * would work until the unit is "fl oz".
 */
export interface Measure {
  value: string;
  unit: string;
}

/**
 * Half of the coarsest unit anything is stored in, as slack on the threshold
 * that picks a unit.
 *
 * `productionLog` stores whole millilitres and grams, so a quart of milk
 * round-trips as 946 mL — 0.35 mL *below* a quart, which read back as "32 fl
 * oz" and made the app disagree with the person who had just tapped out one
 * quart. This is the trap named at the top of this file for mass, arriving
 * for volume because that entity's base is coarser than a microlitre.
 *
 * The slack is smaller than any unit it chooses between by three orders of
 * magnitude, so it can only ever decide a value already sitting on a
 * boundary — which is exactly the storage-rounding case.
 */
const UG_SLACK = 500_000;
const UL_SLACK = 500;

function massParts(ug: Micrograms, system: UnitSystem): Measure {
  if (system === 'metric') {
    const grams = ug / 1_000_000;
    return grams + 0.5 >= 1000
      ? { value: trim(grams / 1000), unit: 'kg' }
      : { value: trim(grams), unit: 'g' };
  }
  return ug + UG_SLACK >= UG_PER_POUND
    ? { value: trim(ugToPounds(ug)), unit: 'lb' }
    : { value: trim(ugToOunces(ug)), unit: 'oz' };
}

/**
 * Fluid ounces only to a quart, then quarts, then gallons.
 *
 * The old version stopped at fluid ounces, which is why nothing ever called
 * it: a ten-goat morning is 676 fl oz, a number that is accurate and tells a
 * farm nothing. A milking is thought about in quarts and a bulk tank in
 * gallons, and the unit has to follow the quantity to stay readable.
 */
function volumeParts(ul: Microlitres, system: UnitSystem): Measure {
  if (system === 'metric') {
    return ul + UL_SLACK >= 1_000_000
      ? { value: trim(ul / 1_000_000), unit: 'L' }
      : { value: trim(ul / 1000), unit: 'mL' };
  }
  if (ul + UL_SLACK >= UL_PER_GALLON) return { value: trim(ul / UL_PER_GALLON), unit: 'gal' };
  if (ul + UL_SLACK >= UL_PER_QUART) return { value: trim(ul / UL_PER_QUART), unit: 'qt' };
  return { value: trim(ulToFluidOunces(ul)), unit: 'fl oz' };
}

export function formatMass(ug: Micrograms, system: UnitSystem): string {
  const { value, unit } = massParts(ug, system);
  return `${value} ${unit}`;
}

export function massIn(ug: Micrograms, system: UnitSystem): Measure {
  return massParts(ug, system);
}

export function formatVolume(ul: Microlitres, system: UnitSystem): string {
  const { value, unit } = volumeParts(ul, system);
  return `${value} ${unit}`;
}

export function volumeIn(ul: Microlitres, system: UnitSystem): Measure {
  return volumeParts(ul, system);
}

// ── entry ────────────────────────────────────────────────────────────────────

/**
 * What a stepper is counting in, and how to get that back to what is stored.
 *
 * Entry is the half that formatting cannot cover. A US farm reading gallons
 * on Today was still being asked for millilitres on the way in — steppers
 * that moved 50 at a time toward a number nobody in the country thinks in.
 *
 * The stepper counts in the fine unit of the farm's system and the total is
 * scaled for display, exactly as mass already works: grams in, kilos out.
 */
export function entryUnit(stored: 'ml' | 'g', system: UnitSystem): string {
  if (system === 'metric') return stored;
  return stored === 'ml' ? 'fl oz' : 'oz';
}

/**
 * Rounded to whole millilitres or grams because that is what the schema
 * accepts. A cup of milk stores as 237 mL and reads back as 8 fl oz.
 */
export function enteredToStored(entered: number, stored: 'ml' | 'g', system: UnitSystem): number {
  if (system === 'metric') return Math.round(entered);
  return stored === 'ml'
    ? Math.round(fluidOuncesToUl(entered) / 1000)
    : Math.round(ouncesToUg(entered) / 1_000_000);
}

export function formatTemperature(dc: DeciCelsius, system: UnitSystem): string {
  return system === 'metric' ? `${trim(dc / 10)}°C` : `${trim(deciCToFahrenheit(dc), 0)}°F`;
}
