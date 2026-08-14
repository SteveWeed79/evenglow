import { describe, expect, it } from 'vitest';
import {
  type FrostDates,
  LIBRARY_VARIETIES,
  nextWindow,
  resolveMonthDay,
  timingOf,
  timingOfRecord,
  type VarietyTiming,
  WINDOW_WORDS,
} from '@steading/contracts';

/**
 * Which of a variety's stages is close enough to today to be offered.
 *
 * The arithmetic behind the seasonal shortcut on the picker. It exists because
 * that screen opened on the whole library alphabetically while the app already
 * held the two dates that say which handful of it can go in this fortnight.
 *
 * Every case here fixes `today` relative to a resolved frost date rather than
 * to a literal, so the suite does not start failing in March.
 */

const YEAR = 2026;
const FROST: FrostDates = { lastSpring: 515, firstAutumn: 1015, source: 'entered' };
const LAST_SPRING = resolveMonthDay(FROST.lastSpring, YEAR);
const FIRST_AUTUMN = resolveMonthDay(FROST.firstAutumn, YEAR);
const DAY = 86_400_000;

const timing = (over: Partial<VarietyTiming>): VarietyTiming => ({
  startIndoorsWeeksBefore: null,
  transplantWeeksAfter: null,
  directSowWeeksAfter: null,
  autumnSowWeeksBefore: null,
  daysToMaturity: null,
  ...over,
});

describe('what is near enough to offer', () => {
  it('says sow now on the day the window opens', () => {
    const window = nextWindow(
      timing({ directSowWeeksAfter: 0, daysToMaturity: 60 }),
      FROST,
      YEAR,
      LAST_SPRING,
    );

    expect(window).not.toBeNull();
    expect(window?.kind).toBe('sow');
    expect(window?.open).toBe(true);
  });

  /** A fortnight early is the whole point: you buy seed before you sow it. */
  it('offers one that has not come round yet, and says it has not', () => {
    const window = nextWindow(
      timing({ directSowWeeksAfter: 0 }),
      FROST,
      YEAR,
      LAST_SPRING - 14 * DAY,
    );

    expect(window?.kind).toBe('sow');
    expect(window?.open).toBe(false);
  });

  /** Still open a fortnight on — a late sowing is late, not impossible. */
  it('keeps offering one whose date has just passed', () => {
    const window = nextWindow(
      timing({ directSowWeeksAfter: 0 }),
      FROST,
      YEAR,
      LAST_SPRING + 14 * DAY,
    );

    expect(window?.open).toBe(true);
  });

  it('drops one that is two months off', () => {
    expect(
      nextWindow(timing({ directSowWeeksAfter: 0 }), FROST, YEAR, LAST_SPRING - 60 * DAY),
    ).toBeNull();
  });

  it('drops one that is two months past', () => {
    expect(
      nextWindow(timing({ directSowWeeksAfter: 0 }), FROST, YEAR, LAST_SPRING + 60 * DAY),
    ).toBeNull();
  });

  it('says nothing about a variety with no timing at all', () => {
    expect(nextWindow(timing({}), FROST, YEAR, LAST_SPRING)).toBeNull();
  });
});

describe('which stage, when more than one is near', () => {
  /**
   * A tomato in May: it should have been started indoors in March and planted
   * out at the end of the month. The one worth saying is the one you can still
   * act on.
   */
  it('takes the nearest, not the first', () => {
    const tomato = timing({
      startIndoorsWeeksBefore: 8,
      transplantWeeksAfter: 2,
      daysToMaturity: 75,
    });

    const window = nextWindow(tomato, FROST, YEAR, LAST_SPRING);

    expect(window?.kind).toBe('plant-out');
  });

  it('picks the indoor start when that is what is near', () => {
    const tomato = timing({
      startIndoorsWeeksBefore: 8,
      transplantWeeksAfter: 2,
      daysToMaturity: 75,
    });

    const window = nextWindow(tomato, FROST, YEAR, LAST_SPRING - 56 * DAY);

    expect(window?.kind).toBe('start-indoors');
  });

  /** Garlic has no spring anchor and must still be offered in its own season. */
  it('finds an autumn sowing', () => {
    const garlic = timing({ autumnSowWeeksBefore: 2, daysToMaturity: 240 });

    const window = nextWindow(garlic, FROST, YEAR, FIRST_AUTUMN - 14 * DAY);

    expect(window?.kind).toBe('autumn-sow');
    expect(window?.open).toBe(true);
  });
});

/**
 * The year is deliberately not walked forward. A December evening offers
 * nothing rather than next February's indoor starts, because the planting the
 * screen writes stamps `season` — and offering next year's date while stamping
 * this year's season would put the record on the wrong season's books.
 */
describe('the year boundary', () => {
  it('does not reach into the following season', () => {
    const early = timing({ startIndoorsWeeksBefore: 16 });
    const december = Date.UTC(YEAR, 11, 20);

    expect(nextWindow(early, FROST, YEAR, december)).toBeNull();
  });
});

describe('timing from a farms own record', () => {
  /**
   * The library's `timingOf` and this must agree, or a variety copied out of
   * the library would schedule differently the second time it was planted —
   * which is exactly the trip the picker now makes when it reuses a record
   * instead of minting another one.
   */
  it('agrees with the library entry it was copied from', () => {
    /**
     * A real entry rather than a hand-built one. A literal shaped like a
     * `LibraryVariety` has to be kept in step with the type by hand, which is
     * a test that breaks for a reason having nothing to do with what it
     * asserts — and it broke exactly that way once, on a `provenance` field
     * this cares nothing about.
     */
    const entry = LIBRARY_VARIETIES.find(
      (v) => v.startIndoorsWeeksBefore !== undefined && v.transplantWeeksAfter !== undefined,
    );
    expect(entry).toBeDefined();
    if (entry === undefined) return;

    expect(timingOfRecord(entry)).toEqual(timingOf(entry));
  });

  it('reads an absent stage as null rather than inventing one', () => {
    expect(timingOfRecord({})).toEqual({
      startIndoorsWeeksBefore: null,
      transplantWeeksAfter: null,
      directSowWeeksAfter: null,
      autumnSowWeeksBefore: null,
      daysToMaturity: null,
    });
  });
});

describe('the words', () => {
  it('has a spoken form for every stage', () => {
    for (const kind of ['start-indoors', 'plant-out', 'sow', 'autumn-sow'] as const) {
      expect(WINDOW_WORDS[kind].length).toBeGreaterThan(0);
    }
  });
});
