import type { DueKind } from './types';

/**
 * How far ahead each kind starts appearing on Today.
 *
 * These are the whole tuning surface of the due engine and they are one table
 * rather than a number scattered through five builders. Every one of them is a
 * claim about how long the *preparation* takes, not about how important the
 * thing is:
 *
 * - A withdrawal is not actionable early. Knowing on Tuesday that eggs clear
 *   on Friday changes nothing you do on Tuesday, and a row that sits there for
 *   three days teaches people to scroll past the list. **One day, and it may
 *   not be zero.** Zero looks like the purest statement of that rule and is
 *   the one value that makes the row unreachable: `urgencyOf` calls a row
 *   `later` until `now >= at - noticeDays * DAY`, which at zero is `now >= at`
 *   — and `activeWithdrawals` drops the withdrawal the instant `at <= now`. So
 *   the row existed only while it was invisible and became visible only once
 *   it had ceased to exist, and no farm has ever seen one. A single day is the
 *   smallest window in which the two overlap, and it says the useful thing:
 *   the eggs come back tomorrow.
 * - A sow window wants a fortnight, because seed has to be to hand and trays
 *   have to be free.
 * - A birth wants six weeks, because someone has to build a pen, move a
 *   pregnant animal, and be around.
 * - A service wants three weeks, because that is roughly how long a filter
 *   takes to arrive.
 * - A clip wants six weeks, because a shearer is booked rather than summoned,
 *   and in spring they are booked out.
 *
 * Overridable per row where a farm knows better; these are the defaults.
 */
export const DEFAULT_NOTICE_DAYS: Record<DueKind, number> = {
  withdrawal: 1,
  service: 21,
  storage: 14,
  'start-indoors': 14,
  sow: 14,
  transplant: 7,
  harvest: 7,
  birth: 42,
  hatch: 21,
  candle: 2,
  processing: 14,
  shearing: 42,
  task: 3,
};
