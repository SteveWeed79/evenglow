import { describe, expect, it } from 'vitest';
import { CROP_DEFAULTS, cropDefaults, LIBRARY_VARIETIES } from '@homefarm/contracts';
import { expand } from '../../packages/contracts/src/library/crops';
import { CATALOGUE_VARIETIES } from '../../packages/contracts/src/library/cultivars';

/**
 * The crop table, and the seam it makes.
 *
 * `library.test.ts` already parses every shipped variety against the schema,
 * checks it has a sowing anchor and produces a coherent schedule — and it now
 * does that for all four hundred odd rather than the original seventy. So this
 * file does not repeat any of it. What is asserted here is only what the split
 * itself introduced:
 *
 * - a crop's defaults actually reach the varieties generated from it,
 * - a typo in a crop key fails loudly instead of shipping a variety with no
 *   family and no timing,
 * - the hand-tuned entries beat the generated ones where both describe the same
 *   variety, which is the one rule a careless merge would silently invert.
 */

describe('a crop and its cultivars', () => {
  it('gives every cultivar the crop it came from', () => {
    const [first] = expand('Pumpkin', [['Black Futsu', 95]]);

    expect(first?.id).toBe('pumpkin-black-futsu');
    expect(first?.crop).toBe('Pumpkin');
    expect(first?.name).toBe('Black Futsu');
    expect(first?.daysToMaturity).toBe(95);
  });

  /** The whole point of the split: eight fields written once, not per cultivar. */
  it('inherits family and spacing from the crop rather than the name', () => {
    const [first] = expand('Pumpkin', [['Black Futsu', 95]]);
    const pumpkin = CROP_DEFAULTS['Pumpkin'];

    expect(first?.family).toBe(pumpkin?.family);
    expect(first?.spacingIn).toBe(pumpkin?.spacingIn);
    expect(first?.sowDepthIn).toBe(pumpkin?.sowDepthIn);
  });

  it('keeps a note when one is given and adds none when it is not', () => {
    const [noted, bare] = expand('Pumpkin', [
      ['Blue Hubbard', 110, 'Also the standard trap crop.'],
      ['Sugar Pie', 100],
    ]);

    expect(noted?.note).toBe('Also the standard trap crop.');
    expect(bare?.note).toBeUndefined();
  });

  /**
   * A crop key that does not exist would otherwise produce a variety with no
   * family, no timing and no way to schedule it — shipped, and only noticed by
   * whoever planted it. Throwing turns a typo into a failed build.
   */
  it('refuses a crop it has no defaults for', () => {
    expect(() => expand('Blueberry', [['Duke', 90]])).toThrow(/Blueberry/);
  });

  it('slugs an id that survives punctuation', () => {
    const [first] = expand('Tomato', [["Aunt Ruby's German Green", 85]]);

    expect(first?.id).toBe('tomato-aunt-rubys-german-green');
  });
});

describe('looking a crop up', () => {
  /**
   * The add-your-own form types a crop by hand, so "pumpkin" and "Pumpkin" have
   * to reach the same answer or the inference is a coin toss.
   */
  it('does not care how it was capitalised or spaced', () => {
    expect(cropDefaults('pumpkin')).toBe(CROP_DEFAULTS['Pumpkin']);
    expect(cropDefaults('  PUMPKIN  ')).toBe(CROP_DEFAULTS['Pumpkin']);
  });

  it('says nothing rather than guessing at a crop it does not know', () => {
    expect(cropDefaults('Dragonfruit')).toBeUndefined();
  });
});

describe('the shipped library', () => {
  it('carries the generated varieties as well as the hand-written ones', () => {
    const ids = new Set(LIBRARY_VARIETIES.map((v) => v.id));

    expect(ids.has('tomato-sungold')).toBe(true);
    expect(ids.has('garlic-inchelium-red')).toBe(true);
    expect(LIBRARY_VARIETIES.length).toBeGreaterThan(CATALOGUE_VARIETIES.length);
  });

  /**
   * Both tables describe Brandywine. `library.test.ts` proves it ships once;
   * this proves it is the right one of the two.
   *
   * The hand-written entries predate the crop table and several carry a figure
   * the crop's defaults would flatten — Brandywine is started a week earlier
   * and spaced wider than a tomato generally is. A merge that let the generated
   * row win would lose that quietly, and every test would still pass.
   */
  it('keeps the hand-tuned entry where both tables describe one variety', () => {
    const shipped = LIBRARY_VARIETIES.filter((v) => v.id === 'tomato-brandywine');
    const generated = CATALOGUE_VARIETIES.find((v) => v.id === 'tomato-brandywine');

    expect(shipped).toHaveLength(1);
    expect(generated).toBeDefined();
    expect(shipped[0]?.startIndoorsWeeksBefore).toBe(7);
    expect(generated?.startIndoorsWeeksBefore).toBe(6);
  });

  /**
   * Days to maturity is the cultivar's own number and the only thing the table
   * carries per name, so a crop whose cultivars all came out identical would
   * mean the tuples were being ignored.
   */
  it('varies the days between cultivars of one crop', () => {
    const peppers = LIBRARY_VARIETIES.filter((v) => v.crop === 'Pepper');
    const days = new Set(peppers.map((v) => v.daysToMaturity));

    expect(peppers.length).toBeGreaterThan(15);
    expect(days.size).toBeGreaterThan(5);
  });

  /**
   * A grower reaching for something ordinary should not be the person who finds
   * the edge of the library. These are the crops the list was built around.
   */
  it('knows the crops a farm plants without thinking about it', () => {
    const crops = new Set(LIBRARY_VARIETIES.map((v) => v.crop));

    for (const crop of ['Tomato', 'Pepper', 'Garlic', 'Onion', 'Carrot', 'Lettuce',
      'Bush bean', 'Sweet corn', 'Winter squash', 'Cabbage', 'Potato', 'Basil']) {
      expect(crops, crop).toContain(crop);
    }
  });
});
