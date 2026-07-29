import { describe, expect, it } from 'vitest';
import {
  canProduce,
  dailyProductsOf,
  isProcessed,
  PRODUCTS,
  PURPOSE_GROUPS,
  productsOf,
  FLOCK_PURPOSES,
  growOutWindow,
  SPECIES,
  suggestedGrowOutWeeks,
  SPECIES_TRAITS,
} from '@steading/contracts';

/**
 * What a group produces is capability AND intent.
 *
 * The bug: Today filtered on `laysEggs(species)` alone, so a flock called
 * "Meat Birds" was offered an egg tally every morning — chickens lay eggs, and
 * nothing was reading the purpose that said what these particular chickens
 * were for. A dairy goat keeper got the opposite failure and saw nothing at
 * all, because milk had never been put on Today.
 */

describe('capability, before anyone says what they want', () => {
  it('knows a chicken lays and a cow does not', () => {
    expect(canProduce('chicken', 'eggs')).toBe(true);
    expect(canProduce('cattle', 'eggs')).toBe(false);
  });

  it('knows an alpaca gives fibre and no milk, and a cow the reverse', () => {
    expect(canProduce('alpaca', 'fibre')).toBe(true);
    expect(canProduce('alpaca', 'milk')).toBe(false);
    expect(canProduce('cattle', 'milk')).toBe(true);
    expect(canProduce('cattle', 'fibre')).toBe(false);
  });

  it('describes every species', () => {
    for (const species of SPECIES) {
      const traits = SPECIES_TRAITS[species];
      expect(typeof traits.givesFibre, species).toBe('boolean');
      expect(typeof traits.givesMilk, species).toBe('boolean');
      expect(typeof traits.laysEggs, species).toBe('boolean');
    }
  });
});

describe('intent narrows it', () => {
  it('offers no egg tally to birds kept only for the table', () => {
    // The exact case from the screenshot: "Meat Birds", chickens, meat only.
    expect(productsOf('chicken', ['meat'])).toEqual([]);
    expect(dailyProductsOf('chicken', ['meat'])).toEqual([]);
  });

  it('offers eggs to birds kept for eggs', () => {
    expect(productsOf('chicken', ['eggs'])).toEqual(['eggs']);
  });

  it('offers both to a flock kept for eggs and then the table', () => {
    // Black Australorps: laying now, processed later. One group, both answers.
    expect(productsOf('chicken', ['eggs', 'meat'])).toEqual(['eggs']);
    expect(isProcessed(['eggs', 'meat'])).toBe(true);
  });

  it('puts milk on a dairy goat and nothing on a fibre-only one', () => {
    expect(dailyProductsOf('goat', ['milk'])).toEqual(['milk']);
    expect(dailyProductsOf('goat', ['fibre'])).toEqual([]);
    expect(productsOf('goat', ['fibre'])).toEqual(['fibre']);
  });

  it('refuses a product the species cannot give however it is asked for', () => {
    // A keeper can tick "milk" on a flock of hens; biology still decides.
    expect(productsOf('chicken', ['milk'])).toEqual([]);
  });

  it('shows everything possible before the question has been answered', () => {
    // A farm mid-setup should see its options rather than a blank Today.
    expect(productsOf('goat', [])).toEqual(['milk', 'fibre']);
    expect(productsOf('chicken', [])).toEqual(['eggs']);
  });
});

describe('what earns a place on Today', () => {
  it('keeps fibre off it', () => {
    // A fleece comes off once a year. A daily wool tally would be a row that
    // is wrong on 363 mornings.
    expect(productsOf('sheep', ['milk', 'fibre'])).toEqual(['milk', 'fibre']);
    expect(dailyProductsOf('sheep', ['milk', 'fibre'])).toEqual(['milk']);
  });

  it('never offers a tally for an animal kept only to guard or to work', () => {
    for (const purposes of [['guarding'], ['work'], ['companion'], ['breeding']]) {
      for (const species of SPECIES) {
        expect(dailyProductsOf(species, purposes), `${species} ${purposes[0]}`).toEqual([]);
      }
    }
  });
});

describe('the questions a keeper is actually asked', () => {
  it('covers every purpose exactly once', () => {
    const grouped = PURPOSE_GROUPS.flatMap((g) => [...g.purposes]);
    expect([...grouped].sort()).toEqual([...FLOCK_PURPOSES].sort());
  });

  it('separates what is collected from what is processed', () => {
    const production = PURPOSE_GROUPS.find((g) => g.key === 'production');
    const processing = PURPOSE_GROUPS.find((g) => g.key === 'processing');

    // Everything in the production group is a product; meat is not, because it
    // is a date rather than a tally.
    expect([...(production?.purposes ?? [])].sort()).toEqual([...PRODUCTS].sort());
    expect(processing?.purposes).toEqual(['meat']);
  });
});

describe('the processing clock, with two real breeds', () => {
  const WEEK = 7 * 86_400_000;
  const hatched = new Date('2026-04-01T00:00:00Z').getTime();

  it('uses the library when the farm has not said otherwise', () => {
    // Cornish Cross: the library says 6-9 weeks and the keeper takes them at
    // seven, so the library is already right and nothing needs overriding.
    const window = growOutWindow({
      id: 'g',
      name: 'Broilers',
      purposes: ['meat'],
      breedId: 'chicken-cornish-cross',
      bornAt: hatched,
    });

    expect(window?.weeks).toEqual([6, 9]);
    expect(window?.opensAt).toBe(hatched + 6 * WEEK);
  });

  it("lets the farm's own figure beat it", () => {
    // Australorp: the library says 16-20, which is the proper-roaster figure.
    // This keeper takes them at eleven, and is not wrong.
    const window = growOutWindow({
      id: 'g',
      name: 'Australorps',
      purposes: ['meat'],
      breedId: 'chicken-australorp',
      bornAt: hatched,
      processAtWeeks: 11,
    });

    expect(window?.weeks).toEqual([11, 11]);
    expect(window?.opensAt).toBe(hatched + 11 * WEEK);
    expect(suggestedGrowOutWeeks('chicken-australorp')).toEqual([16, 20]);
  });

  it('works with no breed at all, given a figure', () => {
    // An unlisted cross used to get silence. It now gets a countdown.
    const window = growOutWindow({
      id: 'g',
      name: 'The mixed lot',
      purposes: ['meat'],
      bornAt: hatched,
      processAtWeeks: 14,
    });
    expect(window?.opensAt).toBe(hatched + 14 * WEEK);
  });

  it('still says nothing without a purpose or a birth date', () => {
    const base = { id: 'g', name: 'x', breedId: 'chicken-cornish-cross', processAtWeeks: 7 };
    // A processing date on a flock of pet bantams is not a helpful default.
    expect(growOutWindow({ ...base, bornAt: hatched, purposes: ['eggs'] })).toBeNull();
    expect(growOutWindow({ ...base, purposes: ['meat'] })).toBeNull();
  });
});
