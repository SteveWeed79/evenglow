import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  dayAfter,
  dayStart,
  type FarmToday,
  forecastSchema,
  warningsFor,
} from '@homefarm/contracts';

/**
 * The two nights a year a day is not 86,400,000 milliseconds long.
 *
 * `warningsFor` is a **today-and-tomorrow** window over a forecast whose days
 * are keyed by local midnight, and it selected tomorrow with
 * `day.day <= today + DAY_MS`. On the fall-back night the local day is
 * twenty-five hours, so that bound lands an hour SHORT of tomorrow's key and
 * tomorrow was not in the window at all — no frost, no freeze, no heat, no
 * newborn in the cold, no clip that must not get wet.
 *
 * One night a year, and it is the night the clocks go back: in most of the
 * temperate world, the week the first hard frost arrives. Nothing appears
 * broken — the strip is simply quiet, which is what the strip is quiet like on
 * every ordinary day.
 *
 * ## Why the timezone is set here rather than assumed
 *
 * CI runs in UTC, where every day is exactly twenty-four hours and the bug
 * cannot happen. So a test that does not choose a zone is a test that proves
 * the arithmetic in the one case where the arithmetic is fine. `TZ` is set per
 * case and restored after — Node re-reads it, and `fileParallelism` is off, so
 * no other suite can be mid-run while it is changed.
 */

const ORIGINAL_TZ = process.env['TZ'];
const DAY_MS = 86_400_000;

/** New York, because its transitions are at 2 a.m. local and well documented. */
function inZone(zone: string, body: () => void): void {
  process.env['TZ'] = zone;
  try {
    body();
  } finally {
    process.env['TZ'] = ORIGINAL_TZ;
  }
}

beforeEach(() => {
  process.env['TZ'] = ORIGINAL_TZ;
});

afterEach(() => {
  process.env['TZ'] = ORIGINAL_TZ;
});

describe('stepping to the next forecast day', () => {
  /**
   * The arithmetic, stated plainly. 2 November 2025 is twenty-five hours long
   * in `America/New_York`, so a fixed day of milliseconds does not reach the
   * next midnight.
   */
  it('reaches tomorrow on the night the clocks go back', () => {
    inZone('America/New_York', () => {
      const today = dayStart(Date.parse('2025-11-02T14:00:00Z'));
      const tomorrow = dayStart(Date.parse('2025-11-03T14:00:00Z'));

      expect(dayAfter(today)).toBe(tomorrow);
      // The bound that used to be used, and the hour it falls short by.
      expect(today + DAY_MS).toBeLessThan(tomorrow);
      expect(tomorrow - today).toBe(25 * 3_600_000);
    });
  });

  /**
   * And the other way, which is the half a milliseconds bound got right for
   * the wrong reason: on the twenty-three-hour night `today + DAY_MS` runs
   * PAST tomorrow's midnight. It happened not to reach the day after, so
   * nothing extra was ever let in — but the bound was never the boundary.
   */
  it('stops at tomorrow on the night the clocks go forward', () => {
    inZone('America/New_York', () => {
      const today = dayStart(Date.parse('2025-03-09T14:00:00Z'));
      const tomorrow = dayStart(Date.parse('2025-03-10T14:00:00Z'));

      expect(dayAfter(today)).toBe(tomorrow);
      expect(today + DAY_MS).toBeGreaterThan(tomorrow);
      expect(tomorrow - today).toBe(23 * 3_600_000);
    });
  });

  /** An ordinary day, so the fix cannot have moved the ordinary case. */
  it('is one plain day the rest of the year', () => {
    inZone('America/New_York', () => {
      const today = dayStart(Date.parse('2025-06-10T14:00:00Z'));
      expect(dayAfter(today)).toBe(today + DAY_MS);
    });
  });
});

describe('the warnings on the night the clocks go back', () => {
  /**
   * The failure itself: a hard frost forecast for tomorrow, on a farm with
   * beds uncovered, on 2 November.
   */
  it('still warns about tomorrow', () => {
    inZone('America/New_York', () => {
      const now = Date.parse('2025-11-02T14:00:00Z');
      const today = dayStart(now);
      const tomorrow = dayStart(Date.parse('2025-11-03T14:00:00Z'));

      const forecast = forecastSchema.parse({
        issuedAt: now,
        now: { condition: 'clear', tempDeciC: 100 },
        days: [
          // Today is mild, so anything raised can only be tomorrow's.
          { day: today, condition: 'clear', highDeciC: 180, lowDeciC: 80, rainChance: 0, rainUm: 0 },
          { day: tomorrow, condition: 'clear', highDeciC: 60, lowDeciC: -30, rainChance: 0, rainUm: 0 },
        ],
        hours: [],
      });

      const farm: FarmToday = { groups: [], uncoveredPlantings: 6, births: [] };
      const warnings = warningsFor({ forecast, stale: false }, farm, now);

      expect(warnings.map((warning) => warning.kind)).toContain('frost');
      expect(warnings.every((warning) => warning.at === tomorrow)).toBe(true);
    });
  });
});
