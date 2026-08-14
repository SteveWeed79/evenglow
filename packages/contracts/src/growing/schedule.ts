import { addDays, addWeeks, DAY_MS, type FrostDates, resolveMonthDay } from './frost';

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
 * The timing a farm's OWN variety record implies.
 *
 * The library's counterpart is `timingOf`, and the two exist separately
 * because the records genuinely differ: a library entry is a bundled constant
 * with `hardyToF` in Fahrenheit and spacings in inches, a farm's record is a
 * synced entity in the canonical units. Only the week offsets are shared, and
 * those are what this pulls out.
 *
 * Needed the moment a screen offers a farm the varieties it already grows —
 * before this, timing could only be read off the library, so a variety
 * somebody added themselves had no dates at all.
 */
export function timingOfRecord(record: {
  startIndoorsWeeksBefore?: number | undefined;
  transplantWeeksAfter?: number | undefined;
  directSowWeeksAfter?: number | undefined;
  autumnSowWeeksBefore?: number | undefined;
  daysToMaturity?: number | undefined;
}): VarietyTiming {
  return {
    startIndoorsWeeksBefore: record.startIndoorsWeeksBefore ?? null,
    transplantWeeksAfter: record.transplantWeeksAfter ?? null,
    directSowWeeksAfter: record.directSowWeeksAfter ?? null,
    autumnSowWeeksBefore: record.autumnSowWeeksBefore ?? null,
    daysToMaturity: record.daysToMaturity ?? null,
  };
}

/** A stage close enough to today to be worth putting in front of somebody. */
export interface PlantingWindow {
  kind: 'start-indoors' | 'plant-out' | 'sow' | 'autumn-sow';
  at: number;
  /** The date has already come: this is open now rather than coming up. */
  open: boolean;
}

/**
 * What each stage is called out loud.
 *
 * Here rather than in the screen for the same reason `PLANTING_WORDS` is: a
 * wire name and a spoken one written down in two places drift.
 */
export const WINDOW_WORDS: Record<PlantingWindow['kind'], string> = {
  'start-indoors': 'Start indoors',
  'plant-out': 'Plant out',
  sow: 'Sow',
  'autumn-sow': 'Sow for autumn',
};

/**
 * Three weeks either side. Wide enough that a crop is offered before the
 * weekend it wants, narrow enough that August does not suggest peas.
 */
const NEAR_DAYS = 21;

/**
 * The stage this variety is nearest to right now, or null.
 *
 * **Why this exists.** Reported from a farm: the planting setup is not user
 * friendly. The visible half of that was a bed card printing a raw status; the
 * larger half is this screen, which opened on the whole library in alphabetical
 * order — a hundred and ninety-three crop headings, tomatoes near the bottom —
 * while the app already held the two frost dates that say which handful of them
 * can go in this fortnight. Knowing the answer and making somebody scroll past
 * it is the app being unhelpful on purpose.
 *
 * A suggestion, never a filter. Everything stays reachable in the full list
 * below it, because a window is a rule of thumb and a grower with a tunnel,
 * a south wall or a warm spring is right more often than the arithmetic is —
 * the same reason hardiness and season length warn rather than block.
 *
 * ## One year, deliberately
 *
 * Only `year` is considered, so a December evening offers nothing rather than
 * next February's indoor starts. That is not laziness: the planting this screen
 * writes carries `season`, and offering a date from the following year while
 * stamping the current one would put a planting on the wrong season's books —
 * a quieter, worse bug than an empty section in the one month of the year when
 * there is genuinely nothing to put in the ground.
 */
export function nextWindow(
  timing: VarietyTiming,
  frost: FrostDates,
  year: number,
  today: number,
): PlantingWindow | null {
  const schedule = scheduleFor(timing, frost, year);

  const stages: [PlantingWindow['kind'], number | null][] = [
    ['start-indoors', schedule.startIndoorsAt],
    ['plant-out', schedule.transplantAt],
    ['sow', schedule.directSowAt],
    ['autumn-sow', schedule.autumnSowAt],
  ];

  let best: PlantingWindow | null = null;
  let bestAway = Infinity;

  for (const [kind, at] of stages) {
    if (at === null) continue;
    const away = Math.abs(at - today);
    if (away > NEAR_DAYS * DAY_MS) continue;
    // Strictly nearer, so a tie keeps the earlier stage — a crop that could be
    // started indoors or sown direct on the same day is offered as the start,
    // which is the one with a deadline.
    if (away >= bestAway) continue;
    best = { kind, at, open: at <= today };
    bestAway = away;
  }

  return best;
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
