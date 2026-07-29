import { describe, expect, it } from 'vitest';
import {
  fahrenheitToDeciC,
  fluidOuncesToUl,
  formatLength,
  formatMass,
  formatTemperature,
  formatVolume,
  gramsToUg,
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
