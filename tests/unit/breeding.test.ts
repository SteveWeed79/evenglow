import { describe, expect, it } from 'vitest';
import {
  birthDue,
  breedingCreateSchema,
  feedNeededUg,
  feedOrderDue,
  feedPlanCreateSchema,
  gramsToUg,
  growOutWindow,
  incubationCreateSchema,
  incubationDues,
  incubationStage,
  layOnsetWindow,
  poundsToUg,
  processingDue,
  ugToPounds,
  shearingCreateSchema,
  urgencyOf,
  weightCreateSchema,
  type Due,
  type GrowOutGroup,
} from '@steading/contracts';

/**
 * Births, hatches, growth, and the grow-out clock.
 *
 * The clock is the part worth reading closely. It answers a question that was
 * asked directly and went unanswered for weeks — "if they are meat birds, why
 * do we not display how long until they can be processed?" — and the reason
 * nothing knew was that nothing recorded a *purpose*. Most of these tests are
 * about the three things it now refuses to guess.
 */

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const NOW = Date.parse('2026-05-15T09:00:00Z');

describe('breeding record', () => {
  const base = { species: 'goat' as const, damId: 'A'.repeat(26), bredAt: NOW, method: 'natural' as const };

  it('accepts a mating with no sire on record', () => {
    // A buck borrowed for a fortnight often has no record on this farm, and
    // requiring one would mean either inventing an animal or not recording it.
    expect(breedingCreateSchema.safeParse(base).success).toBe(true);
  });

  it('carries the outcome separately from the loss', () => {
    const parsed = breedingCreateSchema.safeParse({
      ...base,
      bornAt: NOW + 150 * DAY,
      liveBorn: 0,
      stillborn: 2,
      lost: false,
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses fields that are not in the shape', () => {
    expect(breedingCreateSchema.safeParse({ ...base, gestation: 150 }).success).toBe(false);
  });
});

describe('incubation record', () => {
  const base = {
    species: 'chicken' as const,
    label: 'Buff Orpington, March set',
    setAt: NOW,
    eggsSet: 24,
    source: 'own' as const,
    method: 'incubator' as const,
  };

  it('records a set, then candling, then the hatch', () => {
    expect(incubationCreateSchema.safeParse(base).success).toBe(true);
    expect(incubationCreateSchema.safeParse({ ...base, candledAt: NOW + 7 * DAY, fertile: 19 }).success).toBe(true);
    expect(
      incubationCreateSchema.safeParse({
        ...base,
        candledAt: NOW + 7 * DAY,
        fertile: 19,
        hatchedAt: NOW + 21 * DAY,
        hatched: 17,
        earlyLosses: 1,
      }).success,
    ).toBe(true);
  });

  it('raises candling then hatch, from the species', () => {
    const dues = incubationDues({ id: 'i1', species: 'chicken', setAt: NOW }, base.label);
    expect(dues.map((d) => d.kind)).toEqual(['candle', 'hatch']);
    expect(dues.find((d) => d.kind === 'hatch')?.at).toBe(NOW + 21 * DAY);
  });
});

/**
 * Where a set has got to, from the set date and the species alone.
 *
 * The arithmetic a keeper otherwise does on their fingers every morning, and
 * gets wrong on the morning that matters — turning eggs on day nineteen is the
 * mistake this exists to prevent.
 */
describe('incubation stage', () => {
  const on = (day: number, species = 'chicken'): ReturnType<typeof incubationStage> =>
    incubationStage(species, NOW, NOW + (day - 1) * DAY);

  it('counts from one on the day they went under', () => {
    expect(on(1)).toMatchObject({ day: 1, of: 21, phase: 'turning', title: 'Day 1 of 21' });
  });

  it('names the day everybody knows', () => {
    expect(on(18)).toMatchObject({ day: 18, phase: 'lockdown', title: 'Day 18 of 21' });
    expect(on(17)?.phase).toBe('turning');
  });

  /**
   * The three days are the constant, not the day number. A duck's lockdown is
   * day 25 and a quail's is day 15 for the same reason a chicken's is 18.
   */
  it('keeps lockdown three days out whatever the bird', () => {
    expect(on(25, 'duck')).toMatchObject({ of: 28, phase: 'lockdown' });
    expect(on(24, 'duck')?.phase).toBe('turning');
    expect(on(15, 'quail')).toMatchObject({ of: 18, phase: 'lockdown' });
  });

  it('marks the candling day it already raises a due for', () => {
    expect(on(7)?.phase).toBe('candling');
  });

  it('says hatch day, then says late without setting a deadline', () => {
    expect(on(21)?.phase).toBe('hatching');
    expect(on(22)).toMatchObject({ phase: 'late' });
    expect(on(22)?.guidance).toContain('A day past');
    expect(on(24)?.guidance).toContain('3 days past');
  });

  it('handles a set dated forward', () => {
    expect(on(0)).toMatchObject({ phase: 'ahead', title: 'Under from tomorrow' });
    expect(on(-2)?.title).toBe('Under in 3 days');
  });

  /**
   * A stage derived from a guessed term is worse than no stage: it would put a
   * confident "day 18 of 21, lockdown" on a bird nobody knows the term for.
   */
  it('refuses to guess a term it does not know', () => {
    expect(on(5, 'peafowl')).toBeNull();
  });

  /** The one thing it will not say, and the reason is in the doc comment. */
  it('names no humidity figure anywhere', () => {
    for (const day of [1, 7, 18, 21, 23]) {
      expect(on(day)?.guidance).not.toMatch(/%|humidity/i);
    }
  });
});

describe('weight and shearing', () => {
  const at = { occurredAt: NOW, massUg: poundsToUg(4.2) };

  it('belongs to exactly one animal or one group', () => {
    expect(weightCreateSchema.safeParse({ ...at, animalId: 'A'.repeat(26) }).success).toBe(true);
    expect(weightCreateSchema.safeParse({ ...at, flockId: 'B'.repeat(26) }).success).toBe(true);
    expect(weightCreateSchema.safeParse(at).success).toBe(false);
    expect(
      weightCreateSchema.safeParse({ ...at, animalId: 'A'.repeat(26), flockId: 'B'.repeat(26) }).success,
    ).toBe(false);
  });

  /**
   * A pen of forty birds is weighed by sample, and a growth curve must never
   * plot that as if it were one animal.
   */
  it('marks a group average as sampled', () => {
    expect(
      weightCreateSchema.safeParse({ ...at, flockId: 'B'.repeat(26), sampled: true }).success,
    ).toBe(true);
  });

  it('records a fleece with the animals it came off', () => {
    expect(
      shearingCreateSchema.safeParse({
        occurredAt: NOW,
        flockId: 'B'.repeat(26),
        massUg: poundsToUg(88),
        animalsShorn: 12,
      }).success,
    ).toBe(true);
  });
});

describe('the grow-out clock', () => {
  const chicks: GrowOutGroup = {
    id: 'f1',
    name: 'Meat birds',
    bornAt: NOW,
    breedId: 'chicken-cornish-cross',
    purposes: ['meat'],
  };

  it('opens the window at the start of the range and closes it at the end', () => {
    const window = growOutWindow(chicks);
    expect(window?.weeks).toEqual([6, 9]);
    expect(window?.opensAt).toBe(NOW + 6 * WEEK);
    expect(window?.closesAt).toBe(NOW + 9 * WEEK);
  });

  /**
   * The row anchors at the START of the window: the decision is "book the
   * processor", and that has a lead time. A row appearing when the window was
   * already half gone would arrive after it was useful.
   */
  it('anchors the due row where the decision is made', () => {
    const row = processingDue(chicks) as Due;
    expect(row.at).toBe(NOW + 6 * WEEK);
    expect(row.title).toBe('Meat birds reach processing weight');
    expect(urgencyOf(row, NOW + 6 * WEEK)).toBe('now');
  });

  /**
   * A hen can lay and can be eaten; which the keeper intends is a fact about
   * the keeper. A processing countdown on a flock of pet bantams is not a
   * helpful default, it is an offensive one — which is exactly what
   * `companion`, `breeding` and `guarding` exist to prevent.
   */
  it('will not guess a purpose', () => {
    expect(growOutWindow({ ...chicks, purposes: undefined })).toBeNull();
    expect(growOutWindow({ ...chicks, purposes: ['eggs'] })).toBeNull();
    expect(growOutWindow({ ...chicks, purposes: ['companion'] })).toBeNull();
    expect(processingDue({ ...chicks, purposes: ['breeding'] })).toBeNull();
  });

  /**
   * Day-old chicks bought on Tuesday hatched on Monday; point-of-lay pullets
   * bought on Tuesday are sixteen weeks old. Counting from acquisition would
   * tell someone their pullets are ready to process in six weeks.
   */
  it('will not count from anything but a birth date', () => {
    expect(growOutWindow({ ...chicks, bornAt: undefined })).toBeNull();
  });

  it('will not invent a figure for an unknown or unlisted breed', () => {
    expect(growOutWindow({ ...chicks, breedId: undefined })).toBeNull();
    expect(growOutWindow({ ...chicks, breedId: 'chicken-does-not-exist' })).toBeNull();
    // Khaki Campbells are layers; the library carries no grow-out for them.
    expect(growOutWindow({ ...chicks, breedId: 'duck-khaki-campbell' })).toBeNull();
  });

  /** A heritage bird is both, and gets both clocks. */
  it('gives a dual-purpose flock a processing window and a lay window', () => {
    const dual: GrowOutGroup = {
      id: 'f2',
      name: 'Rhode Islands',
      bornAt: NOW,
      breedId: 'chicken-rhode-island-red',
      purposes: ['eggs', 'meat'],
    };

    expect(growOutWindow(dual)?.weeks).toEqual([16, 20]);
    expect(layOnsetWindow(dual)?.weeks).toEqual([18, 22]);
  });

  it('gives an egg flock no processing clock, and vice versa', () => {
    const layers: GrowOutGroup = {
      id: 'f3',
      name: 'Leghorns',
      bornAt: NOW,
      breedId: 'chicken-leghorn-white',
      purposes: ['eggs'],
    };

    expect(growOutWindow(layers)).toBeNull();
    expect(layOnsetWindow(layers)?.opensAt).toBe(NOW + 16 * WEEK);
  });
});

describe('feed', () => {
  it('predicts the bag from the ration and the head count', () => {
    const ration = poundsToUg(0.25);
    // 40 birds, quarter pound each, 30 days = 300 lb.
    expect(ugToPounds(feedNeededUg(ration, 40, 30) as number)).toBeCloseTo(300, 4);
  });

  /**
   * The limit of the exactness claim, stated rather than hidden.
   *
   * Micrograms make a whole pound exact, but a QUARTER pound is 113,398,092.5
   * of them, so the ration itself rounds by half a microgram and that half
   * compounds across the multiplication. It is 600 µg over three hundred
   * pounds — six ten-thousandths of a gram — and the reason it is fine is that
   * feed is bought in 50 lb bags, not weighed to the microgram. Anywhere that
   * genuinely needs exactness, the entered figure is the integer.
   */
  it('rounds the ration, not the total, and the error stays negligible', () => {
    const drift = (feedNeededUg(poundsToUg(0.25), 40, 30) as number) - poundsToUg(300);
    expect(Math.abs(drift)).toBeLessThan(1000);
  });

  /** Rather than an estimate built on a guess about how much a goat eats. */
  it('refuses to estimate without a plan', () => {
    expect(feedNeededUg(null, 40, 30)).toBeNull();
    expect(feedNeededUg(0, 40, 30)).toBeNull();
    expect(feedNeededUg(poundsToUg(0.25), 40, 0)).toBeNull();
  });

  it('records a ration that can be superseded', () => {
    const plan = {
      flockId: 'B'.repeat(26),
      feedName: 'Grower crumble, 20%',
      perAnimalPerDayUg: poundsToUg(0.25),
      startedAt: NOW,
    };
    expect(feedPlanCreateSchema.safeParse(plan).success).toBe(true);
    expect(feedPlanCreateSchema.safeParse({ ...plan, endedAt: NOW + 60 * DAY }).success).toBe(true);
  });
});

describe('birth', () => {
  it('dates from the species and clears when the kid arrives', () => {
    const bred = { id: 'br1', species: 'goat', damId: 'A'.repeat(26), bredAt: NOW };
    expect((birthDue(bred, 'Willow') as Due).at).toBe(NOW + 150 * DAY);
    expect(birthDue({ ...bred, bornAt: NOW + 149 * DAY }, 'Willow')).toBeNull();
  });
});

/**
 * When the sack runs out (§2d).
 *
 * `feedPlanShape` has promised this row since it was written, and until a
 * screen could write a ration there was nothing to predict from. The
 * arithmetic is deliberately the plainest in the app; what is worth testing is
 * everything it *refuses* to answer, because a confident date from a guessed
 * conversion is worse than no row.
 */
describe('ordering feed before the bin is empty', () => {
  const NOW = 1_700_000_000_000;
  const DAILY = gramsToUg(500); // half a kilo each, per day

  const due = (over: Partial<{ ration: number | null; head: number; onHandUg: number | null }> = {}) =>
    feedOrderDue(
      'F'.repeat(26),
      'The goats',
      over.ration === undefined ? DAILY : over.ration,
      over.head ?? 4,
      { feedName: 'Goat mix', onHandUg: over.onHandUg === undefined ? gramsToUg(40_000) : over.onHandUg },
      NOW,
    );

  it('dates the row when ordering becomes necessary, not when the bin empties', () => {
    // 40 kg, four goats at half a kilo each: two kilos a day, twenty days left.
    const row = due();
    expect(row).not.toBeNull();

    const daysOut = Math.round((row!.at! - NOW) / DAY);
    // Twenty days of feed, minus the week it takes to get to the store and
    // back with a sack. Dating it at empty would raise the row on the morning
    // it is already too late, which is the surprise this replaces.
    expect(daysOut).toBe(13);
  });

  it('names the feed and the group, because a farm runs more than one', () => {
    expect(due()!.title).toBe('Order Goat mix for The goats');
    // The authored kind, like ordering a part: a new DueKind would mean a new
    // mark and a new branch in every consumer to say what `task` already says.
    expect(due()!.kind).toBe('task');
    expect(due()!.subject).toEqual({ entity: 'flock', id: 'F'.repeat(26) });
  });

  it('comes round sooner as the herd grows', () => {
    const four = due({ head: 4 })!.at!;
    const eight = due({ head: 8 })!.at!;
    // Twice the mouths, half the days. The ration is stored per animal for
    // exactly this reason — head count changes and the ration does not.
    expect(eight).toBeLessThan(four);
  });

  /**
   * The refusals, which are the point.
   */
  it('says nothing about a sack counted in bales', () => {
    // The shelf knows it has three bales; it does not know what a bale weighs,
    // and neither does this app.
    expect(due({ onHandUg: null })).toBeNull();
  });

  it('says nothing about a group with no ration', () => {
    // Most groups on most farms. Null, not a guess about how much a goat eats.
    expect(due({ ration: null })).toBeNull();
  });

  it('says nothing when there is nothing to divide by', () => {
    expect(due({ ration: 0 })).toBeNull();
    expect(due({ head: 0 })).toBeNull();
  });

  /**
   * An empty bin is not an error — it is the most urgent version of the row,
   * and it must still appear rather than being filtered out for being in the
   * past.
   */
  it('still raises a row when the feed has already run out', () => {
    const row = due({ onHandUg: 0 });
    expect(row).not.toBeNull();
    expect(row!.at!).toBeLessThan(NOW);
  });
});
