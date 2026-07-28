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

export function formatMass(ug: Micrograms, system: UnitSystem): string {
  if (system === 'metric') {
    const grams = ug / 1_000_000;
    return grams >= 1000 ? `${trim(grams / 1000)} kg` : `${trim(grams)} g`;
  }
  const pounds = ugToPounds(ug);
  return pounds >= 1 ? `${trim(pounds)} lb` : `${trim(ugToOunces(ug))} oz`;
}

export function formatVolume(ul: Microlitres, system: UnitSystem): string {
  if (system === 'metric') return ul >= 1_000_000 ? `${trim(ul / 1_000_000)} L` : `${trim(ul / 1000)} mL`;
  return `${trim(ulToFluidOunces(ul))} fl oz`;
}

export function formatTemperature(dc: DeciCelsius, system: UnitSystem): string {
  return system === 'metric' ? `${trim(dc / 10)}°C` : `${trim(deciCToFahrenheit(dc), 0)}°F`;
}
