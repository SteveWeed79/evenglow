import { dayStart } from './weather';

/**
 * Whole days, on the calendar rather than in milliseconds.
 *
 * ## The bug this ends, for the fourth time
 *
 * A day is 86,400,000 milliseconds on 363 nights a year and not on the other
 * two, and "how many days until" measured from *this instant* rather than from
 * midnight moves through the afternoon. Both mistakes have been found and fixed
 * in this codebase more than once, each time in one file:
 *
 * - `DueRow` measured `(at - now)` from the moment of render against dates
 *   anchored at midnight, so a job due today read **"yesterday"** after lunch
 *   and one due tomorrow read **"today"**. Fixed there, by anchoring both ends.
 * - `weather.ts` stepped a forecast day by a fixed span and dropped every
 *   warning for tomorrow on the night the clocks go back. Fixed there, with
 *   `dayAfter`.
 * - `read/trend.ts` walked weekly buckets back by `7 × 86,400,000` across a
 *   transition and rendered a month of zeros. Fixed there.
 *
 * Meanwhile `Notes` still said a note from yesterday evening was left "2 days
 * ago" by ten at night, and three screens printed a hatch date a day early
 * every autumn. The fix was known and it kept being applied to one file. So it
 * is here, once, and the screens call it.
 *
 * `dayStart` is `weather.ts`'s and is reused rather than written a fifth time.
 */

/**
 * Calendar days from one moment to another — negative when `to` is earlier.
 *
 * Both ends are taken to local midnight first, so the answer is a property of
 * the two *dates* and does not change between breakfast and supper. `Math.round`
 * on the difference of two midnights is also right across a daylight-saving
 * change, where the span is 23 or 25 hours and the ratio is 0.96 or 1.04.
 */
export function daysBetween(from: number, to: number): number {
  return Math.round((dayStart(to) - dayStart(from)) / 86_400_000);
}

/**
 * A moment moved by whole calendar days, landing at local midnight.
 *
 * `setDate` steps the calendar whatever each day's length, and the midnight
 * after it re-normalises onto one that exists. A fixed span would put a set of
 * eggs put under in October at 23:00 the evening *before* its hatch date once
 * the clocks had gone back — and `toLocaleDateString` would then print that
 * earlier day.
 */
export function addCalendarDays(at: number, days: number): number {
  const date = new Date(at);
  date.setDate(date.getDate() + days);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
