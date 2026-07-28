import { describe, expect, it } from 'vitest';
import {
  breedsForPurpose,
  breedsForSpecies,
  formatRange,
  LIBRARY_BREEDS,
  LIBRARY_VARIETIES,
  libraryBreed,
  libraryCrops,
  libraryVariety,
  midpoint,
  PLANT_FAMILIES,
  PURPOSES,
  scheduleFor,
  searchBreeds,
  searchVarieties,
  SPECIES_TRAITS,
  timingOf,
  umToInches,
  varietyCreateSchema,
  varietyPayload,
  type FrostDates,
  type LibraryBreed,
} from '@steading/contracts';

/**
 * The bundled reference library.
 *
 * These are data tests, and the thing they defend against is a typo that no
 * type can catch: a transplant date before the seedlings are started, a range
 * written backwards, a species that does not exist. Every one of those looks
 * fine in review and produces a wrong date on a screen someone plans a season
 * around.
 *
 * They do NOT check that the numbers are *correct* — no test can. What they
 * check is that every entry is a valid record, internally consistent, and
 * survives the conversion into the canonical units.
 */

const FROST: FrostDates = { lastSpring: 515, firstAutumn: 1005, source: 'entered' };

describe('varieties', () => {
  it('ships a usable library', () => {
    expect(LIBRARY_VARIETIES.length).toBeGreaterThanOrEqual(60);
  });

  it('has unique ids', () => {
    const ids = LIBRARY_VARIETIES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * The conversion boundary. If an entry cannot become a record, it is
   * decoration — it can be browsed and never planted.
   */
  it('every entry converts into a valid variety payload', () => {
    for (const entry of LIBRARY_VARIETIES) {
      const result = varietyCreateSchema.safeParse(varietyPayload(entry));
      expect(result.success, `${entry.id}: ${result.error?.message ?? ''}`).toBe(true);
    }
  });

  it('keeps inches exact through the round trip', () => {
    for (const entry of LIBRARY_VARIETIES) {
      if (entry.spacingIn === undefined) continue;
      const payload = varietyPayload(entry);
      expect(umToInches(payload['spacingUm'] as number)).toBeCloseTo(entry.spacingIn, 6);
    }
  });

  it('uses only declared plant families', () => {
    for (const entry of LIBRARY_VARIETIES) {
      expect(PLANT_FAMILIES).toContain(entry.family);
    }
  });

  /**
   * Every variety needs at least one way into the ground. One with none would
   * produce a schedule of all nulls — browsable, unplantable, and silent
   * about why.
   */
  it('gives every variety at least one anchor', () => {
    for (const entry of LIBRARY_VARIETIES) {
      const anchored =
        entry.directSowWeeksAfter !== undefined ||
        entry.transplantWeeksAfter !== undefined ||
        entry.autumnSowWeeksBefore !== undefined;
      expect(anchored, `${entry.id} has no sow or transplant anchor`).toBe(true);
    }
  });

  /** Seedlings cannot be planted out before they were started. */
  it('never transplants before the indoor start', () => {
    for (const entry of LIBRARY_VARIETIES) {
      if (entry.startIndoorsWeeksBefore === undefined || entry.transplantWeeksAfter === undefined) {
        continue;
      }
      const startWeeks = -entry.startIndoorsWeeksBefore;
      expect(
        entry.transplantWeeksAfter,
        `${entry.id} transplants ${entry.transplantWeeksAfter}w after frost but starts ${startWeeks}w`,
      ).toBeGreaterThan(startWeeks);
    }
  });

  /** A start-indoors with nowhere to go is a tray nobody is told to empty. */
  it('never starts seedlings indoors without a transplant date', () => {
    for (const entry of LIBRARY_VARIETIES) {
      if (entry.startIndoorsWeeksBefore === undefined) continue;
      expect(entry.transplantWeeksAfter, `${entry.id}`).toBeDefined();
    }
  });

  it('produces a coherent schedule for every entry', () => {
    for (const entry of LIBRARY_VARIETIES) {
      const s = scheduleFor(timingOf(entry), FROST, 2026);
      const anchor = s.transplantAt ?? s.directSowAt ?? s.autumnSowAt;

      expect(anchor, `${entry.id} produced no anchor date`).not.toBeNull();
      expect(s.firstHarvestAt, `${entry.id} produced no harvest date`).not.toBeNull();
      // Harvest after the plant is in the ground, always.
      expect(s.firstHarvestAt as number).toBeGreaterThan(anchor as number);

      if (s.startIndoorsAt !== null && s.transplantAt !== null) {
        expect(s.transplantAt, `${entry.id}`).toBeGreaterThan(s.startIndoorsAt);
      }
    }
  });

  /**
   * Garlic is the entry that proves the model. Autumn-sown, no spring anchor
   * at all, and a made-up indoor start would put a row on someone's Today
   * telling them to do something nobody does.
   */
  it('leaves an autumn-sown crop with no spring stages', () => {
    const garlic = libraryVariety('garlic-music');
    expect(garlic).toBeDefined();

    const s = scheduleFor(timingOf(garlic!), FROST, 2026);
    expect(s.startIndoorsAt).toBeNull();
    expect(s.directSowAt).toBeNull();
    expect(s.transplantAt).toBeNull();
    expect(s.autumnSowAt).not.toBeNull();
  });

  it('finds varieties by crop and by cultivar', () => {
    expect(searchVarieties('sungold').map((v) => v.id)).toContain('tomato-sungold');
    expect(searchVarieties('tomato').length).toBeGreaterThanOrEqual(4);
    expect(searchVarieties('  ')).toEqual([]);
  });

  it('lists crops without repeating them', () => {
    const crops = libraryCrops();
    expect(new Set(crops).size).toBe(crops.length);
    expect(crops).toContain('Tomato');
    expect([...crops]).toEqual([...crops].sort((a, b) => a.localeCompare(b)));
  });
});

describe('breeds', () => {
  it('ships a usable library', () => {
    expect(LIBRARY_BREEDS.length).toBeGreaterThanOrEqual(40);
  });

  it('has unique ids', () => {
    const ids = LIBRARY_BREEDS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /** A breed on a species the app does not know cannot be selected at all. */
  it('uses only species the app knows', () => {
    for (const breed of LIBRARY_BREEDS) {
      expect(Object.keys(SPECIES_TRAITS), `${breed.id}`).toContain(breed.species);
    }
  });

  it('uses only declared purposes, and gives every breed at least one', () => {
    for (const breed of LIBRARY_BREEDS) {
      expect(breed.purposes.length, `${breed.id}`).toBeGreaterThan(0);
      for (const purpose of breed.purposes) expect(PURPOSES).toContain(purpose);
    }
  });

  /**
   * Ranges written backwards are the typo this file exists for. `[9, 6]`
   * type-checks, reads fine, and produces a countdown that has already ended.
   */
  it('never writes a range backwards', () => {
    const ranges = (b: LibraryBreed): [string, readonly number[] | undefined][] => [
      ['growOutWeeks', b.growOutWeeks],
      ['layOnsetWeeks', b.layOnsetWeeks],
      ['layRatePerYear', b.layRatePerYear],
      ['milkLitresPerDay', b.milkLitresPerDay],
      ['matureWeightKg.female', b.matureWeightKg?.female],
      ['matureWeightKg.male', b.matureWeightKg?.male],
    ];

    for (const breed of LIBRARY_BREEDS) {
      for (const [field, range] of ranges(breed)) {
        if (range === undefined) continue;
        expect(range).toHaveLength(2);
        expect(range[0], `${breed.id}.${field}`).toBeLessThanOrEqual(range[1] as number);
        expect(range[0], `${breed.id}.${field}`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * A purpose the app cannot act on is a label. If a breed says meat, the
   * grow-out clock has to have something to count.
   */
  it('carries the figure each purpose needs', () => {
    for (const breed of LIBRARY_BREEDS) {
      if (breed.purposes.includes('meat')) {
        expect(breed.growOutWeeks, `${breed.id} is meat with no grow-out`).toBeDefined();
      }
      if (breed.purposes.includes('milk')) {
        expect(breed.milkLitresPerDay, `${breed.id} is dairy with no yield`).toBeDefined();
      }
      if (breed.purposes.includes('fibre')) {
        expect(breed.fibreIntervalMonths, `${breed.id} is fibre with no interval`).toBeDefined();
      }
    }
  });

  /** Layers need both, or the app can neither predict nor evaluate them. */
  it('gives every layer an onset and a rate', () => {
    for (const breed of LIBRARY_BREEDS) {
      if (!breed.purposes.includes('eggs')) continue;
      expect(breed.layRatePerYear, `${breed.id}`).toBeDefined();
    }
  });

  it('finds breeds by name, species and the words people actually say', () => {
    expect(searchBreeds('cornish x').map((b) => b.id)).toContain('chicken-cornish-cross');
    expect(searchBreeds('barred rock').map((b) => b.id)).toContain('chicken-plymouth-rock');
    expect(searchBreeds('broiler').map((b) => b.id)).toContain('chicken-cornish-cross');
  });

  it('groups by species and by purpose', () => {
    expect(breedsForSpecies('goat').length).toBeGreaterThanOrEqual(6);
    expect(breedsForPurpose('milk').map((b) => b.species)).toContain('cattle');
    // Dual-purpose breeds appear under both, rather than being forced into one.
    const dual = libraryBreed('chicken-rhode-island-red');
    expect(dual?.purposes).toContain('eggs');
    expect(dual?.purposes).toContain('meat');
  });
});

describe('ranges on screen', () => {
  it('states a range once, with one unit', () => {
    expect(formatRange([6, 9], 'weeks')).toBe('6–9 weeks');
  });

  /** Equal ends mean the figure really is agreed, so do not fake a spread. */
  it('collapses when both ends agree', () => {
    expect(formatRange([21, 21], 'days')).toBe('21 days');
  });

  it('takes a midpoint for arithmetic, never for display', () => {
    expect(midpoint([6, 9])).toBe(7.5);
  });
});
