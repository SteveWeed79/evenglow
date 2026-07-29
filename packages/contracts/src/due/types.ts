import type { Entity } from '../mutation';

/**
 * The due engine.
 *
 * A withdrawal window closing, a hatch date, a sow window opening after last
 * frost, a 250-hour service and a doe due to kid look like five features and
 * are one:
 *
 * > Something becomes **due** at a date or at a meter reading, it appears on
 * > **Today** when it is near, and it stops appearing because the event it was
 * > waiting for was logged.
 *
 * Build this once and each domain is mostly a table of intervals. Build it
 * three times and the app is three apps sharing a tab bar.
 *
 * ## Three properties, and each is a lesson from something already built
 *
 * **1. Derived, not authored.** A due row is computed from the records that
 * imply it — a treatment implies a withdrawal, an hour reading implies a
 * service, a planting implies a sow date. Nobody types a reminder in.
 * Reminders people have to enter are reminders people stop entering, and an
 * app whose alerts are only as good as its data entry is an app that quietly
 * stops warning about anything.
 *
 * **2. Recomputed locally, never pushed.** No notification server, no cloud
 * scheduler. The device knows the last hour reading and the interval, and it
 * can do arithmetic with the radio off. That is the feature, not a limitation.
 *
 * **3. Nothing is "marked done".** A due row has no completion flag and no
 * `clearedBy` field, and that is a correction to the first sketch of this
 * design. You do not tick off a service — you log the service, and the next
 * recomputation simply does not produce that row, because the record it was
 * waiting for now exists. A stored completion flag is a second source of
 * truth about whether something happened, and the two drift.
 *
 * Which is why `Due` is a projection and not a syncable entity. It never
 * crosses the wire, so it cannot conflict, cannot be rejected, and needs no
 * schema on the envelope.
 */

export const DUE_KINDS = [
  /** Produce is inside a withdrawal window and clears on this date (W2). */
  'withdrawal',
  /** A machine service, by date or by hour meter. */
  'service',
  /** Seasonal put-away: winterising, fuel stabiliser, blades off. */
  'storage',
  'start-indoors',
  'sow',
  'transplant',
  'harvest',
  /** A doe, ewe, cow or sow due to give birth. */
  'birth',
  /** Eggs set, and the day they are due to hatch. */
  'hatch',
  /** Candling, roughly a week into an incubation. */
  'candle',
  /** Meat stock reaching processing weight or age. */
  'processing',
  /** A chore the farm entered itself. The one authored kind. */
  'task',
] as const;

export type DueKind = (typeof DUE_KINDS)[number];

/**
 * How close a due row is, once notice has been taken into account.
 *
 * Four steps rather than a boolean because they carry different instructions.
 * `soon` is "order the filter"; `now` is "do it today"; `overdue` is "this
 * did not happen." A single is-it-due flag collapses the first two, which is
 * exactly where a farm loses a week waiting on a part.
 */
export const URGENCIES = ['later', 'soon', 'now', 'overdue'] as const;
export type Urgency = (typeof URGENCIES)[number];

export interface Due {
  /**
   * Stable across recomputations for the same underlying fact.
   *
   * Not an ID — there is nothing to store. It exists so a list rendered every
   * few seconds keeps its order and its React keys, and so two builders
   * cannot silently produce the same row twice.
   */
  key: string;
  kind: DueKind;
  subject: { entity: Entity; id: string };
  /** One line, already in the farm's words. "Sow Sungold in Bed 3." */
  title: string;

  /**
   * Exactly one of these two is set.
   *
   * A service is by date or by hours, never both — a machine with an hour
   * meter is serviced on hours, and one without is serviced on dates. Carrying
   * both would mean every consumer branches, and the branch would be wrong
   * half the time because nobody would know which took precedence.
   */
  at: number | null;
  atReading: number | null;

  /**
   * When `atReading` is set and usage is known, the date that reading is
   * expected to arrive. This is what lets an hours-based service sort into the
   * same list as a date-based one.
   */
  projectedAt: number | null;

  /**
   * How far ahead this starts appearing on Today.
   *
   * Per-row, because the right answer differs by an order of magnitude. A
   * withdrawal wants the day it clears and not before — it is not actionable
   * early. A sow window wants a fortnight, because seed has to be to hand. A
   * kidding wants six weeks, because someone has to build a pen.
   */
  noticeDays: number;
}

const DAY_MS = 86_400_000;

/** The effective date: the real one, or the projection for a meter row. */
export function dueDate(due: Due): number | null {
  return due.at ?? due.projectedAt;
}

/**
 * How close this is, right now.
 *
 * A row with a meter target and no usage estimate is `later`, never `now`.
 * Guessing that an unknown-usage machine is due today would put a row on
 * Today that nothing can clear, and a list with a permanent resident on it is
 * a list people stop reading.
 */
export function urgencyOf(due: Due, now: number): Urgency {
  const at = dueDate(due);
  if (at === null) return 'later';

  if (now >= at) {
    // The day it lands is 'now'; the day after is 'overdue'. A due row that
    // flips to overdue at one minute past midnight on the day it is due would
    // call a farmer late for something they are about to do after breakfast.
    return now >= at + DAY_MS ? 'overdue' : 'now';
  }

  return now >= at - due.noticeDays * DAY_MS ? 'soon' : 'later';
}

/** Whether this belongs on Today at all. */
export function isVisible(due: Due, now: number): boolean {
  return urgencyOf(due, now) !== 'later';
}

const URGENCY_ORDER: Record<Urgency, number> = { overdue: 0, now: 1, soon: 2, later: 3 };

/**
 * Overdue first, then soonest.
 *
 * The tie-break is the key rather than the title, so a list cannot reorder
 * itself between renders when two things fall on the same day — which looks,
 * to someone glancing at a phone in a barn, exactly like something changed.
 */
export function compareDues(a: Due, b: Due, now: number): number {
  const byUrgency = URGENCY_ORDER[urgencyOf(a, now)] - URGENCY_ORDER[urgencyOf(b, now)];
  if (byUrgency !== 0) return byUrgency;

  const at = dueDate(a);
  const bt = dueDate(b);
  if (at !== null && bt !== null && at !== bt) return at - bt;
  if (at === null && bt !== null) return 1;
  if (bt === null && at !== null) return -1;

  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** What Today shows: visible rows, most pressing first. */
export function todayList(dues: readonly Due[], now: number): Due[] {
  return dues.filter((d) => isVisible(d, now)).sort((a, b) => compareDues(a, b, now));
}

/**
 * When a machine is expected to reach a meter reading.
 *
 * Returns null rather than a guess when usage is unknown or non-positive. A
 * machine nobody has recorded twice has no usage rate, and a projection built
 * on one reading is a straight line through a single point.
 */
export function projectReading(
  currentReading: number,
  perDay: number | null,
  target: number,
  now: number,
): number | null {
  if (perDay === null || perDay <= 0) return null;
  if (currentReading >= target) return now;
  return now + ((target - currentReading) / perDay) * DAY_MS;
}
