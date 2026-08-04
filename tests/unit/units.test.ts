import { describe, expect, it } from 'vitest';
import {
  fahrenheitToDeciC,
  fluidOuncesToUl,
  formatLength,
  formatMass,
  formatTemperature,
  formatVolume,
  gramsToUg,
  enteredToStored,
  entryUnit,
  mlToUl,
  inchesToUm,
  ouncesToUg,
  poundsToUg,
  ugToPounds,
  ulToFluidOunces,
  umToInches,
} from '@steading/contracts';

/**
 * Units.
 *
 * The reason this file exists: a farm that switches display units must not
 * rewrite its history, and a running total must not drift. Both of those are
 * properties of the storage decision, not of the formatting, so that is what
 * is asserted hardest.
 */

describe('round trips', () => {
  it('survives a round trip within the base unit', () => {
    for (const inches of [0.25, 1, 6, 12, 36, 120]) {
      expect(umToInches(inchesToUm(inches))).toBeCloseTo(inches, 3);
    }
    for (const pounds of [0.5, 1, 4, 50, 2000]) {
      expect(ugToPounds(poundsToUg(pounds))).toBeCloseTo(pounds, 5);
    }
    for (const ounces of [0.1, 0.5, 1, 16]) {
      expect(ulToFluidOunces(fluidOuncesToUl(ounces))).toBeCloseTo(ounces, 4);
    }
  });

  it('holds the reference points exactly enough to matter', () => {
    // Exact, both directions. That is the whole reason for these bases.
    expect(inchesToUm(12)).toBe(304_800);
    expect(inchesToUm(0.25)).toBe(6_350);
    expect(poundsToUg(1)).toBe(453_592_370);
    expect(ouncesToUg(16)).toBe(poundsToUg(1));
    expect(fahrenheitToDeciC(32)).toBe(0);
    expect(fahrenheitToDeciC(-20)).toBe(-289); // USDA 5a floor
  });
});

/**
 * The property the whole design is for. Adding a hundred half-pound harvests
 * as integers is exact; as floats it is not, and the place that surfaces is a
 * total someone is selling against.
 */
describe('integer storage', () => {
  it('sums without drift', () => {
    const half = poundsToUg(0.5);
    let total = 0;
    for (let i = 0; i < 1000; i++) total += half;

    expect(Number.isInteger(total)).toBe(true);
    expect(ugToPounds(total)).toBe(500);
  });

  it('stores the same value whichever system was used to enter it', () => {
    // 1 lb typed by a US grower; 453.59237 g typed by anyone else. Identical
    // rows, so a sum over a farm that switched systems mid-year is still right.
    expect(poundsToUg(1)).toBe(gramsToUg(453.59237));
  });
});

describe('display', () => {
  it('shows imperial by default and metric on request', () => {
    expect(formatLength(inchesToUm(6), 'imperial')).toBe('6 in');
    expect(formatLength(inchesToUm(6), 'metric')).toBe('15.2 cm');

    expect(formatMass(poundsToUg(4), 'imperial')).toBe('4 lb');
    expect(formatMass(poundsToUg(4), 'metric')).toBe('1.8 kg');

    expect(formatTemperature(fahrenheitToDeciC(0), 'imperial')).toBe('0°F');
    expect(formatTemperature(fahrenheitToDeciC(32), 'metric')).toBe('0°C');
  });

  /** A seed packet says 12", not 12.0". Invented precision is noise. */
  it('drops a trailing zero', () => {
    expect(formatLength(inchesToUm(6), 'imperial')).toBe('6 in');
    expect(formatMass(poundsToUg(2), 'imperial')).toBe('2 lb');
    expect(formatVolume(fluidOuncesToUl(1), 'imperial')).toBe('1 fl oz');
  });

  /**
   * Feet only past a yard. "38 in" is more use to someone holding a tape than
   * "3.2 ft", and bed dimensions are the only place this gets large.
   */
  it('switches to the larger unit only where it helps', () => {
    expect(formatLength(inchesToUm(30), 'imperial')).toBe('30 in');
    expect(formatLength(inchesToUm(48), 'imperial')).toBe('4 ft');
    expect(formatMass(ouncesToUg(8), 'imperial')).toBe('8 oz');
    expect(formatMass(poundsToUg(1), 'imperial')).toBe('1 lb');
  });
});

/**
 * Volume, and the entry half.
 *
 * The defect behind these: `formatVolume` stopped at fluid ounces and had no
 * callers, so milk was hardcoded to millilitres on three screens. A US farm
 * read 95°F four rows above "100 ML" on the same screen, and the steppers on
 * the way in moved fifty millilitres at a time.
 */
describe('volume scales to the quantity', () => {
  it('climbs from fluid ounces through quarts to gallons', () => {
    expect(formatVolume(fluidOuncesToUl(8), 'imperial')).toBe('8 fl oz');
    // A quart is where a milking pail starts being the unit somebody says.
    expect(formatVolume(fluidOuncesToUl(32), 'imperial')).toBe('1 qt');
    expect(formatVolume(fluidOuncesToUl(48), 'imperial')).toBe('1.5 qt');
    expect(formatVolume(fluidOuncesToUl(128), 'imperial')).toBe('1 gal');
    expect(formatVolume(fluidOuncesToUl(640), 'imperial')).toBe('5 gal');
  });

  it('climbs from millilitres to litres', () => {
    expect(formatVolume(mlToUl(500), 'metric')).toBe('500 mL');
    expect(formatVolume(mlToUl(2400), 'metric')).toBe('2.4 L');
  });

  /**
   * The screenshot that started this. Ten goats is gallons, not millilitres,
   * and the old imperial branch would have said "676 fl oz".
   */
  it('reads a herd morning as a number somebody would say', () => {
    const tenGoats = mlToUl(20_000);
    expect(formatVolume(tenGoats, 'imperial')).toBe('5.3 gal');
    expect(formatVolume(tenGoats, 'metric')).toBe('20 L');
  });
});

describe('entry', () => {
  it('counts in the fine unit of whichever system is set', () => {
    expect(entryUnit('ml', 'metric')).toBe('ml');
    expect(entryUnit('ml', 'imperial')).toBe('fl oz');
    expect(entryUnit('g', 'metric')).toBe('g');
    expect(entryUnit('g', 'imperial')).toBe('oz');
  });

  it('stores what was typed, in the unit the schema takes', () => {
    // Metric is already the stored unit, so nothing is done to it.
    expect(enteredToStored(500, 'ml', 'metric')).toBe(500);
    expect(enteredToStored(250, 'g', 'metric')).toBe(250);

    // A cup, a pint, a quart.
    expect(enteredToStored(8, 'ml', 'imperial')).toBe(237);
    expect(enteredToStored(16, 'ml', 'imperial')).toBe(473);
    expect(enteredToStored(32, 'ml', 'imperial')).toBe(946);

    expect(enteredToStored(16, 'g', 'imperial')).toBe(454);
  });

  /** The schema is `z.number().int()`; a fraction is a 400, not a rounding. */
  it('always stores an integer', () => {
    for (const entered of [1, 3, 7, 8, 13, 32, 100]) {
      for (const stored of ['ml', 'g'] as const) {
        const value = enteredToStored(entered, stored, 'imperial');
        expect(Number.isInteger(value)).toBe(true);
      }
    }
  });

  /**
   * Entry and display are separate halves and have to agree, or a farm taps
   * out a quart and is told it logged something else.
   */
  it('reads back what was tapped in', () => {
    const quart = enteredToStored(32, 'ml', 'imperial');
    expect(formatVolume(mlToUl(quart), 'imperial')).toBe('1 qt');

    const pound = enteredToStored(16, 'g', 'imperial');
    expect(formatMass(gramsToUg(pound), 'imperial')).toBe('1 lb');

    const cup = enteredToStored(8, 'ml', 'imperial');
    expect(formatVolume(mlToUl(cup), 'imperial')).toBe('8 fl oz');
  });
});

/**
 * The slack on the unit thresholds.
 *
 * It exists so a stored value that lost a fraction on the way in still reads
 * as the thing that was typed. It must not do anything else.
 */
describe('threshold slack', () => {
  it('does not promote a value that is genuinely short', () => {
    // Half a fluid ounce below a quart is not a quart by any reading.
    expect(formatVolume(fluidOuncesToUl(31.5), 'imperial')).toBe('31.5 fl oz');
    expect(formatVolume(mlToUl(900), 'metric')).toBe('900 mL');
    expect(formatMass(gramsToUg(900), 'metric')).toBe('900 g');
  });

  it('only reaches as far as one stored unit of rounding', () => {
    // 946 mL is the stored quart. A millilitre further out is not, and stays
    // in fluid ounces rather than being promoted to a unit nobody typed.
    //
    // It still *renders* as "32 fl oz", because the display rounds to a
    // tenth — which is a separate question from which unit was chosen, and
    // the point here is that the unit did not change.
    expect(formatVolume(mlToUl(946), 'imperial')).toBe('1 qt');
    expect(formatVolume(mlToUl(945), 'imperial')).toBe('32 fl oz');
  });
});
