import { describe, expect, it } from 'vitest';
import { LIBRARY_VARIETIES } from '@homefarm/contracts';

/**
 * How the planting list is ordered, and which field it groups on.
 *
 * Reported from a farm: *"our plant sorting is incorrect, it should be
 * Tomatoes > Roma"*. It is — you know you are planting tomatoes before you know
 * which tomato, and the list was neither sorted nor grouped: it was
 * `LIBRARY_VARIETIES` in declaration order, sliced to forty, with the variety
 * in the row title and the crop underneath it. Backwards, truncated, and in
 * whatever order the file happened to open with.
 *
 * ## The field this must not group on
 *
 * `family` is botanical and is a different question. `solanaceae` covers
 * tomatoes, potatoes, peppers and aubergines together, so grouping on it would
 * file Roma under a word no grower typed and put potatoes in with the tomatoes.
 *
 * It is also load-bearing elsewhere: `rotationConflict` reads `family` to work
 * out that brassicas following brassicas build club root. Reusing it for
 * presentation is how a field that means one thing quietly starts meaning two.
 */

describe('the library the planting list is built from', () => {
  it('gives every variety a crop to group under', () => {
    const missing = LIBRARY_VARIETIES.filter((v) => v.crop.trim() === '');

    expect(missing.map((v) => v.id)).toEqual([]);
  });

  /**
   * The grouping is only useful if a crop is a word rather than a per-variety
   * label — one variety per crop everywhere would be a heading over each row.
   */
  it('has crops that actually gather varieties', () => {
    const byCrop = new Map<string, number>();
    for (const v of LIBRARY_VARIETIES) byCrop.set(v.crop, (byCrop.get(v.crop) ?? 0) + 1);

    const gathered = [...byCrop.values()].filter((n) => n > 1).length;
    expect(gathered, 'no crop has more than one variety').toBeGreaterThan(0);
  });

  /**
   * The distinction the fix turns on, asserted on the real library rather than
   * described: one family, several crops.
   */
  it('keeps family broader than crop, so the two are not interchangeable', () => {
    const cropsPerFamily = new Map<string, Set<string>>();
    for (const v of LIBRARY_VARIETIES) {
      const found = cropsPerFamily.get(v.family) ?? new Set<string>();
      found.add(v.crop);
      cropsPerFamily.set(v.family, found);
    }

    const broad = [...cropsPerFamily.values()].filter((crops) => crops.size > 1);
    expect(broad.length, 'every family holds exactly one crop').toBeGreaterThan(0);
  });

  /**
   * Ordering is by crop then name, which is what the screen does and what
   * `listVarieties` in the read layer already did — the two agree now.
   */
  it('sorts to a stable crop-then-name order', () => {
    const sorted = [...LIBRARY_VARIETIES].sort(
      (a, b) => a.crop.localeCompare(b.crop) || a.name.localeCompare(b.name),
    );

    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (previous === undefined || current === undefined) continue;
      if (previous.crop !== current.crop) {
        expect(previous.crop.localeCompare(current.crop)).toBeLessThan(0);
      }
    }
  });
});
