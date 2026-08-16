import { z } from 'zod';

/**
 * Frost dates — when things go in the ground.
 *
 * The other half of the pair. A hardiness zone says what survives the winter;
 * these two dates say how long the growing season is and therefore when every
 * annual is sown, started, transplanted and pulled. Neither substitutes for
 * the other, which is why a site carries both.
 *
 * ## Stored as a recurring day, not a timestamp
 *
 * "Last frost is May 15th" is a fact about a place, not about 2026. Storing an
 * epoch would make the schedule silently wrong every January, and a farm
 * planning three seasons ahead would need three copies of the same fact.
 *
 * A `MonthDay` is `month * 100 + day` — 515 for May 15. Sortable, readable in
 * a debugger, and it cannot be confused with a timestamp by anything that
 * happens to be holding a number.
 *
 * ## February 29
 *
 * Accepted and stored, because somebody's records will contain it. Resolved to
 * February 28 in a common year rather than rolling into March, so a frost date
 * never drifts past the end of the month it belongs to.
 */

export type MonthDay = number;

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function monthDay(month: number, day: number): MonthDay {
  return month * 100 + day;
}

/**
 * `monthDay` backwards, in the same 1-indexed months it takes.
 *
 * Here rather than in the screen that wanted it, because an encoding and its
 * inverse belong together — a second decoding written next to a date picker is
 * how `515` eventually gets read as May the 1st somewhere.
 *
 * Does not validate: a caller holding a `MonthDay` has one that was validated
 * on the way in, and a caller holding garbage should see the garbage rather
 * than a plausible substitute.
 */
export function splitMonthDay(value: MonthDay): { month: number; day: number } {
  return { month: Math.floor(value / 100), day: value % 100 };
}

export function isValidMonthDay(value: number): boolean {
  if (!Number.isInteger(value)) return false;
  const month = Math.floor(value / 100);
  const day = value % 100;
  if (month < 1 || month > 12) return false;
  const max = DAYS_IN_MONTH[month - 1];
  return max !== undefined && day >= 1 && day <= max;
}

export const monthDaySchema = z
  .number()
  .int()
  .refine(isValidMonthDay, { message: 'Not a valid month and day (MMDD, e.g. 515 for 15 May)' });

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/**
 * The UTC timestamp of this recurring day in a given year.
 *
 * UTC on purpose. A frost date is a calendar fact and every offset computed
 * from it is in whole days; doing that arithmetic in local time means a farm
 * that crosses a daylight-saving boundary mid-schedule gets dates an hour out,
 * and an hour is enough to move a date when it lands near midnight.
 */
export function resolveMonthDay(md: MonthDay, year: number): number {
  const month = Math.floor(md / 100);
  let day = md % 100;

  // Feb 29 in a common year falls back rather than rolling into March.
  if (month === 2 && day === 29 && !isLeapYear(year)) day = 28;

  return Date.UTC(year, month - 1, day);
}

export const DAY_MS = 86_400_000;

export function addDays(at: number, days: number): number {
  return at + days * DAY_MS;
}

export function addWeeks(at: number, weeks: number): number {
  return addDays(at, weeks * 7);
}

/**
 * A site's two dates, and where they came from.
 *
 * `source` is recorded because it changes how much the app should trust them.
 * A farmer who typed their own dates knows their land; a bundled average for a
 * postcode is a starting point that deserves to be labelled as one on screen.
 */
export const FROST_SOURCES = ['entered', 'lookup', 'bundled'] as const;
export const frostSourceSchema = z.enum(FROST_SOURCES);
export type FrostSource = z.infer<typeof frostSourceSchema>;

export const frostDatesSchema = z
  .object({
    /** Average last spring frost. Everything sown in spring counts from here. */
    lastSpring: monthDaySchema,
    /** Average first autumn frost. Everything harvested counts back from here. */
    firstAutumn: monthDaySchema,
    source: frostSourceSchema,
  })
  .strict();

export type FrostDates = z.infer<typeof frostDatesSchema>;

/**
 * Days between last spring frost and first autumn frost.
 *
 * The number that decides whether a 120-day melon is possible at all. Computed
 * for a specific year so leap years are right, and clamped at zero rather than
 * going negative — a site whose frost dates are the wrong way round is a data
 * error, and a negative growing season would propagate into every date
 * downstream instead of showing up where it was entered.
 */
export function growingSeasonDays(frost: FrostDates, year: number): number {
  const start = resolveMonthDay(frost.lastSpring, year);
  const end = resolveMonthDay(frost.firstAutumn, year);
  return Math.max(0, Math.round((end - start) / DAY_MS));
}

/**
 * Whether a crop has time to finish before the first autumn frost.
 *
 * Advice, never a refusal — the same rule as hardiness. Short seasons are
 * routinely beaten with a tunnel, a cloche or transplants bought in, and an
 * app that hides a tomato from a zone 4 grower is an app that is wrong about
 * that grower.
 */
export function fitsSeason(daysToMaturity: number, frost: FrostDates, year: number): boolean {
  return daysToMaturity <= growingSeasonDays(frost, year);
}
