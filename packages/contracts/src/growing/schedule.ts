import { addDays, addWeeks, type FrostDates, resolveMonthDay } from './frost';

/**
 * Turning a seed packet into dates.
 *
 * This is the arithmetic the whole Growing tab rests on, and it is pure — no
 * store, no clock, no network. A packet says "start indoors 6–8 weeks before
 * last frost, transplant 2 weeks after"; a site says last frost is May 15th;
 * this says March 27th and May 29th. Every one of those dates becomes a due
 * row on Today.
 *
 * That it is arithmetic rather than a lookup is the reason the app works in a
 * field with no signal. Nothing here needs a server, ever.
 */

/**
 * The timing a variety carries. Every field is nullable because they genuinely
 * vary: garlic is autumn-sown and has no spring anchor at all, lettuce is
 * direct-sown with no indoor stage, and a perennial crown is planted once.
 */
export interface VarietyTiming {
  /** Weeks BEFORE last spring frost to start indoors. */
  startIndoorsWeeksBefore: number | null;
  /** Weeks AFTER last spring frost to move seedlings out. Negative = before. */
  transplantWeeksAfter: number | null;
  /** Weeks AFTER last spring frost to sow straight into the ground. */
  directSowWeeksAfter: number | null;
  /** From sowing (or transplant, for started plants) to first pick. */
  daysToMaturity: number | null;
  /** Weeks BEFORE first autumn frost, for garlic and autumn-sown crops. */
  autumnSowWeeksBefore: number | null;
}

export interface PlantingSchedule {
  startIndoorsAt: number | null;
  transplantAt: number | null;
  directSowAt: number | null;
  autumnSowAt: number | null;
  /**
   * First expected pick. Counted from whichever event actually puts the plant
   * in the ground — days-to-maturity on a packet means from transplant for
   * things that get transplanted, and from sowing for things that do not.
   */
  firstHarvestAt: number | null;
}

/**
 * The planned dates for one variety at one site in one year.
 *
 * Every field is null when the variety does not have that stage, rather than
 * being filled with a plausible default. A garlic row with a made-up indoor
 * start date would put a due row on someone's Today telling them to do
 * something nobody does.
 */
export function scheduleFor(
  timing: VarietyTiming,
  frost: FrostDates,
  year: number,
): PlantingSchedule {
  const lastSpring = resolveMonthDay(frost.lastSpring, year);
  const firstAutumn = resolveMonthDay(frost.firstAutumn, year);

  const startIndoorsAt =
    timing.startIndoorsWeeksBefore === null
      ? null
      : addWeeks(lastSpring, -timing.startIndoorsWeeksBefore);

  const transplantAt =
    timing.transplantWeeksAfter === null ? null : addWeeks(lastSpring, timing.transplantWeeksAfter);

  const directSowAt =
    timing.directSowWeeksAfter === null ? null : addWeeks(lastSpring, timing.directSowWeeksAfter);

  const autumnSowAt =
    timing.autumnSowWeeksBefore === null
      ? null
      : addWeeks(firstAutumn, -timing.autumnSowWeeksBefore);

  /**
   * Counted from the moment the plant is in its final position.
   *
   * A packet's "75 days" for a tomato means 75 days from transplant, not from
   * the seed going into a tray in February — the tray weeks are not counted
   * because a seedling under lights is not making fruit. Getting this backwards
   * puts first harvest six weeks early, which is exactly the kind of quietly
   * wrong that erodes trust in every other date on the screen.
   */
  const anchor = transplantAt ?? directSowAt ?? autumnSowAt;
  const firstHarvestAt =
    anchor === null || timing.daysToMaturity === null
      ? null
      : addDays(anchor, timing.daysToMaturity);

  return { startIndoorsAt, transplantAt, directSowAt, autumnSowAt, firstHarvestAt };
}

/**
 * Successive sowings of the same variety through one season.
 *
 * Salad, beans, carrots and radish are sown every two or three weeks so the
 * harvest arrives steadily instead of all at once — which is the difference
 * between a family eating lettuce for a month and a family composting lettuce
 * for a week.
 *
 * Sowings stop when the crop can no longer finish before first frost. That
 * cutoff is what makes this useful rather than a calendar loop: a fixed count
 * would happily schedule an August sowing that never matures.
 */
export function successionSowings(
  timing: VarietyTiming,
  frost: FrostDates,
  year: number,
  intervalDays: number,
): number[] {
  const first = scheduleFor(timing, frost, year);
  const start = first.directSowAt ?? first.transplantAt;
  if (start === null || timing.daysToMaturity === null || intervalDays <= 0) return [];

  const lastUseful = addDays(resolveMonthDay(frost.firstAutumn, year), -timing.daysToMaturity);

  const sowings: number[] = [];
  // Bounded independently of the date arithmetic. A frost pair entered the
  // wrong way round should produce nothing, not spin.
  for (let at = start; at <= lastUseful && sowings.length < 52; at = addDays(at, intervalDays)) {
    sowings.push(at);
  }
  return sowings;
}
