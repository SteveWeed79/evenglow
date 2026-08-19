import { describe, expect, it } from 'vitest';
import {
  addDays,
  DAY_MS,
  fitsSeason,
  type FrostDates,
  growingSeasonDays,
  hardinessVerdict,
  isValidMonthDay,
  monthDay,
  resolveMonthDay,
  scheduleFor,
  successionSowings,
  type VarietyTiming,
  type Zone,
  zoneFloor,
} from '@homefarm/contracts';

/**
 * The growing arithmetic.
 *
 * Every date the Growing tab shows comes out of these three modules, and the
 * failure mode is not a crash — it is a first-harvest date six weeks early, on
 * a screen someone plans a season around. So the assertions here are about
 * being right rather than about not throwing.
 */

/** Zone 6b, roughly: last frost mid-May, first frost early October. */
const FROST: FrostDates = { lastSpring: 515, firstAutumn: 1005, source: 'entered' };

const day = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

describe('month-day', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isValidMonthDay(515)).toBe(true);
    expect(isValidMonthDay(1231)).toBe(true);
    expect(isValidMonthDay(229)).toBe(true); // stored; resolved per year
    expect(isValidMonthDay(230)).toBe(false);
    expect(isValidMonthDay(1301)).toBe(false);
    expect(isValidMonthDay(400)).toBe(false);
    expect(isValidMonthDay(431)).toBe(false); // April has 30
  });

  it('resolves to the same calendar day in any year', () => {
    expect(resolveMonthDay(monthDay(5, 15), 2026)).toBe(day('2026-05-15'));
    expect(resolveMonthDay(monthDay(5, 15), 2030)).toBe(day('2030-05-15'));
  });

  /**
   * February 29 falls back to the 28th rather than rolling into March. A frost
   * date must not leave the month it belongs to, and `new Date(2027, 1, 29)`
   * silently becomes March 1st.
   */
  it('falls February 29 back to the 28th in a common year', () => {
    expect(resolveMonthDay(229, 2028)).toBe(day('2028-02-29'));
    expect(resolveMonthDay(229, 2027)).toBe(day('2027-02-28'));
  });
});

describe('growing season', () => {
  it('counts the days between the two frosts', () => {
    // 15 May to 5 October 2026.
    expect(growingSeasonDays(FROST, 2026)).toBe(143);
  });

  it('is a day longer across a leap February — and is not, when February is outside it', () => {
    // Both frosts are after February, so a leap day does not lengthen it.
    expect(growingSeasonDays(FROST, 2028)).toBe(143);
  });

  /**
   * A negative season would propagate into every downstream date rather than
   * failing where it was entered.
   */
  it('clamps a reversed frost pair to zero rather than going negative', () => {
    const reversed: FrostDates = { lastSpring: 1005, firstAutumn: 515, source: 'entered' };
    expect(growingSeasonDays(reversed, 2026)).toBe(0);
  });

  it('reports whether a crop has time to finish', () => {
    expect(fitsSeason(75, FROST, 2026)).toBe(true);
    expect(fitsSeason(160, FROST, 2026)).toBe(false);
  });
});

describe('hardiness', () => {
  const zone = (value: string): Zone => ({ system: 'usda', value });

  it('reads USDA floors off the Fahrenheit bands', () => {
    // 7a is 0 °F, which is -17.8 °C — not a round Celsius number, and it must
    // not be rounded to one.
    expect(zoneFloor(zone('7a'))).toBe(-178);
    expect(zoneFloor(zone('5b'))).toBe(-261);
  });

  it('normalises case and spacing, and only that', () => {
    expect(zoneFloor(zone(' 7A '))).toBe(-178);
    expect(zoneFloor(zone('nonsense'))).toBeNull();
  });

  it('says hardy when the winter low stays above what the plant takes', () => {
    // Zone 7a bottoms out at -17.8 °C; a fig hardy to -15 °C does not make it.
    expect(hardinessVerdict(zone('7a'), -150)).toBe('tender-here');
    // Hardy to -25 °C, and the zone only reaches -17.8.
    expect(hardinessVerdict(zone('7a'), -250)).toBe('hardy');
  });

  /**
   * Unknown, never an assumption. A false "hardy" costs someone a tree; a
   * false "tender" only costs a sentence they can ignore.
   */
  it('answers unknown rather than guessing', () => {
    expect(hardinessVerdict(null, -250)).toBe('unknown');
    expect(hardinessVerdict(zone('7a'), null)).toBe('unknown');
    expect(hardinessVerdict({ system: 'ahs-heat', value: '7' }, -250)).toBe('unknown');
  });
});

describe('schedule', () => {
  /** A tomato: 6 weeks in, out 2 weeks after frost, 75 days to first fruit. */
  const tomato: VarietyTiming = {
    startIndoorsWeeksBefore: 6,
    transplantWeeksAfter: 2,
    directSowWeeksAfter: null,
    daysToMaturity: 75,
    autumnSowWeeksBefore: null,
  };

  it('anchors both spring stages to last frost', () => {
    const s = scheduleFor(tomato, FROST, 2026);

    expect(s.startIndoorsAt).toBe(day('2026-04-03')); // 6 weeks before 15 May
    expect(s.transplantAt).toBe(day('2026-05-29')); // 2 weeks after
    expect(s.directSowAt).toBeNull();
  });

  /**
   * The mistake this test exists for: counting 75 days from the tray in April
   * rather than from the transplant in May puts first harvest six weeks early.
   * A seedling under lights is not making fruit.
   */
  it('counts days to maturity from transplant, not from the indoor start', () => {
    const s = scheduleFor(tomato, FROST, 2026);
    expect(s.firstHarvestAt).toBe(addDays(day('2026-05-29'), 75));
    expect(s.firstHarvestAt).not.toBe(addDays(day('2026-04-03'), 75));
  });

  it('counts from sowing for a crop that is never transplanted', () => {
    const radish: VarietyTiming = {
      startIndoorsWeeksBefore: null,
      transplantWeeksAfter: null,
      directSowWeeksAfter: 0,
      daysToMaturity: 28,
      autumnSowWeeksBefore: null,
    };

    const s = scheduleFor(radish, FROST, 2026);
    expect(s.directSowAt).toBe(day('2026-05-15'));
    expect(s.firstHarvestAt).toBe(addDays(day('2026-05-15'), 28));
  });

  /**
   * Garlic has no spring anchor at all. A made-up indoor start would put a due
   * row on someone's Today telling them to do something nobody does.
   */
  it('leaves stages a variety does not have as null, not as a default', () => {
    const garlic: VarietyTiming = {
      startIndoorsWeeksBefore: null,
      transplantWeeksAfter: null,
      directSowWeeksAfter: null,
      daysToMaturity: 240,
      autumnSowWeeksBefore: 3,
    };

    const s = scheduleFor(garlic, FROST, 2026);
    expect(s.startIndoorsAt).toBeNull();
    expect(s.transplantAt).toBeNull();
    expect(s.directSowAt).toBeNull();
    expect(s.autumnSowAt).toBe(day('2026-09-14')); // 3 weeks before 5 October
    expect(s.firstHarvestAt).toBe(addDays(day('2026-09-14'), 240));
  });

  /** A transplant date before last frost is legitimate for hardy brassicas. */
  it('allows a transplant before last frost', () => {
    const kale: VarietyTiming = {
      startIndoorsWeeksBefore: 6,
      transplantWeeksAfter: -2,
      directSowWeeksAfter: null,
      daysToMaturity: 55,
      autumnSowWeeksBefore: null,
    };

    expect(scheduleFor(kale, FROST, 2026).transplantAt).toBe(day('2026-05-01'));
  });
});

describe('succession', () => {
  const lettuce: VarietyTiming = {
    startIndoorsWeeksBefore: null,
    transplantWeeksAfter: null,
    directSowWeeksAfter: 0,
    daysToMaturity: 45,
    autumnSowWeeksBefore: null,
  };

  it('sows every interval and stops while there is still time to mature', () => {
    const sowings = successionSowings(lettuce, FROST, 2026, 14);

    expect(sowings[0]).toBe(day('2026-05-15'));
    // Every gap is the interval.
    for (let i = 1; i < sowings.length; i++) {
      expect((sowings[i] ?? 0) - (sowings[i - 1] ?? 0)).toBe(14 * DAY_MS);
    }

    /**
     * The point of the cutoff. A fixed count would happily schedule a sowing
     * in September that never heads up before frost.
     */
    const last = sowings.at(-1) ?? 0;
    expect(addDays(last, 45)).toBeLessThanOrEqual(day('2026-10-05'));
    expect(addDays(last + 14 * DAY_MS, 45)).toBeGreaterThan(day('2026-10-05'));
  });

  it('returns nothing rather than spinning on bad input', () => {
    expect(successionSowings(lettuce, FROST, 2026, 0)).toEqual([]);

    const reversed: FrostDates = { lastSpring: 1005, firstAutumn: 515, source: 'entered' };
    expect(successionSowings(lettuce, reversed, 2026, 14)).toEqual([]);
  });
});
