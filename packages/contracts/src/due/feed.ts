import { DEFAULT_NOTICE_DAYS } from './notice';
import type { Due } from './types';
import { feedNeededUg } from './growout';

/**
 * When the sack runs out, said before it does.
 *
 * This is the whole reason `feedPlan` exists. `feedPlanShape` has promised it
 * since it was written — *"a bag running out is discovered rather than
 * predicted, and 'order feed' is exactly the kind of thing that should arrive
 * as a due row rather than as a surprise on a Sunday"* — and until a screen
 * could write a ration there was nothing to predict from.
 *
 * ## The same shape as ordering a part, deliberately
 *
 * `partsDue` answers "is the filter in the barn" for a service; this answers
 * "is the feed in the bin" for a group. Both are a stock level against a known
 * consumption, both are dated by a lead time rather than by the moment of
 * running out, and both are their own row rather than a flag on something
 * else — because ordering is discharged by ordering.
 *
 * It carries `kind: 'task'` for the same reason `partsDue` does: it is a chore
 * a person does, and a new `DueKind` would mean a new mark, a new notice
 * entry, and a new branch in every consumer, to say something the authored
 * kind already says.
 *
 * ## What it refuses to answer
 *
 * **A sack counted in bags or bales.** The shelf knows it has three bales; it
 * does not know what a bale weighs, and neither does this app. The condition
 * is exactly the one `FeedScreen` already uses to decide whether it may draw
 * the shelf down — weight both sides, or nothing happens. A farm that keeps
 * hay in bales gets no row rather than a date computed from an invented
 * conversion.
 *
 * **A group with no ration**, which is most groups on most farms. Null, not a
 * guess about how much a goat eats.
 */

const DAY_MS = 86_400_000;

/**
 * A week.
 *
 * Shorter than a part's three, and the reason is the supply chain: a filter is
 * ordered and posted, feed is fetched from a store that is open on Saturday.
 * What the week actually buys is the trip — a farm that learns on the morning
 * the bin empties has to make a special journey, and one that learns a week
 * out puts it on the list with everything else.
 */
export const FEED_LEAD_DAYS = 7;

export interface FeedStock {
  /** Micrograms of this feed on the shelf, or null when it is counted in bales. */
  onHandUg: number | null;
  feedName: string;
}

/**
 * @param perAnimalPerDayUg the ration in force, or null when there is none
 * @param headCount how many are eating today
 * @param stock what the shelf holds of that feed
 * @param now used to date the row; the caller's clock, never a new Date here
 */
export function feedOrderDue(
  flockId: string,
  groupName: string,
  perAnimalPerDayUg: number | null,
  headCount: number,
  stock: FeedStock,
  now: number,
  leadDays = FEED_LEAD_DAYS,
): Due | null {
  if (stock.onHandUg === null) return null;

  const perDayUg = feedNeededUg(perAnimalPerDayUg, headCount, 1);
  // No ration, no head, or a ration of zero. Nothing to divide by, and nothing
  // honest to say.
  if (perDayUg === null || perDayUg <= 0) return null;

  const daysLeft = stock.onHandUg / perDayUg;
  const emptyAt = now + daysLeft * DAY_MS;

  return {
    key: `${flockId}:feed-order`,
    kind: 'task',
    subject: { entity: 'flock', id: flockId },
    /**
     * Names the feed and the group, because a farm running three rations needs
     * to know which sack — and "order feed" on its own is a row somebody has
     * to open the app twice to act on.
     */
    title: `Order ${stock.feedName} for ${groupName}`,
    /**
     * The day ordering becomes necessary, not the day the bin empties.
     *
     * That is the arithmetic the row exists for. Dating it at empty would put
     * the row up on the morning it is already too late, which is the surprise
     * this replaces.
     */
    at: emptyAt - leadDays * DAY_MS,
    atReading: null,
    projectedAt: null,
    /**
     * The authored default. Three days of gentle warning on top of the week
     * of lead time is ten days' notice on a feed run, which is about one
     * ordinary shopping trip — and short enough that the row is not sitting
     * there so long it stops being read.
     */
    noticeDays: DEFAULT_NOTICE_DAYS.task,
  };
}
