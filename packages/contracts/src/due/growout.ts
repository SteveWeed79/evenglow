import { libraryBreed } from '../library';
import type { Range } from '../library/types';
import { DEFAULT_NOTICE_DAYS } from './notice';
import type { Due } from './types';

/**
 * The grow-out clock.
 *
 * "If they are meat birds, why do we not display how long until they can be
 * processed?" — and the answer was that nothing knew they were meat birds.
 * Now `flock.purposes` says so, `flock.breedId` says which bird, and the
 * library says how long.
 *
 * ## Three things this deliberately refuses to do
 *
 * **It will not guess a purpose.** A hen can lay and can be eaten; which the
 * keeper intends is a fact about the keeper. Without an explicit `meat`
 * purpose there is no countdown, because a processing date on a flock of pet
 * bantams is not a helpful default, it is an offensive one.
 *
 * **It will not count from acquisition.** Day-old chicks bought on Tuesday
 * hatched on Monday; point-of-lay pullets bought on Tuesday are sixteen weeks
 * old. `bornAt` or nothing.
 *
 * **It will not collapse the range.** The library says six to nine weeks
 * because that is what is true. The due row is anchored at the START of the
 * window, and the window is what the screen shows — a single date would throw
 * away exactly the honesty the range was carrying, and a farm that misses it
 * by four days would conclude the app is wrong rather than that the number was
 * always approximate.
 *
 * ## The farm's own number wins
 *
 * `processAtWeeks` overrides the library entirely, and that is the point of
 * having it. The library says an Australorp is a 16-to-20-week bird — the
 * figure for a proper roaster — and a keeper who takes the same bird at eleven
 * is describing their own practice, not making a mistake. The library is a
 * starting point; the farm is the authority about the farm.
 *
 * An override is a single number rather than a range, because that is how the
 * answer arrives: "mine are ready at eleven weeks." Inventing a spread around
 * it would be the app adding uncertainty nobody expressed.
 */

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export interface GrowOutGroup {
  id: string;
  name: string;
  /** Hatched or born. NOT when they arrived. */
  bornAt?: number | undefined;
  breedId?: string | undefined;
  purposes?: readonly string[] | undefined;
  /** The farm's own figure, in weeks. Beats the library when set. */
  processAtWeeks?: number | undefined;
  /**
   * The most recent deliberate cull recorded against this group.
   *
   * The record that discharges the processing row — see `processingDue`. From
   * `mortality` rows with `cause: 'cull'`, which is what the loss screen writes
   * when a keeper says the birds were processed rather than lost.
   */
  lastCulledAt?: number | undefined;
}

export interface GrowOutWindow {
  /** Earliest sensible processing date. */
  opensAt: number;
  /** Latest, past which a fast-growing bird starts to fail. */
  closesAt: number;
  weeks: Range;
}

/**
 * When this group reaches processing weight, or null if that is unanswerable.
 *
 * Null for every reason it should be: no `meat` purpose, no birth date, no
 * breed, or a breed with no grow-out figure. Each of those is a genuine "we
 * do not know", and a guess in place of any of them is a wrong date presented
 * with the same confidence as a right one.
 */
export function growOutWindow(group: GrowOutGroup): GrowOutWindow | null {
  if (!group.purposes?.includes('meat')) return null;
  if (group.bornAt === undefined) return null;

  const weeks = growOutWeeksFor(group);
  if (weeks === null) return null;

  return {
    opensAt: group.bornAt + weeks[0] * WEEK_MS,
    closesAt: group.bornAt + weeks[1] * WEEK_MS,
    weeks,
  };
}

/**
 * The figure to count with: the farm's, then the library's, then nothing.
 *
 * Note the order — an override needs no breed, so a farm running an unlisted
 * cross is no longer stuck with silence just because the library has never
 * heard of their bird.
 */
export function growOutWeeksFor(group: GrowOutGroup): Range | null {
  if (group.processAtWeeks !== undefined) {
    return [group.processAtWeeks, group.processAtWeeks];
  }
  if (group.breedId === undefined) return null;
  return libraryBreed(group.breedId)?.growOutWeeks ?? null;
}

/** What the library would say, so a screen can offer it as a starting point. */
export function suggestedGrowOutWeeks(breedId: string | undefined): Range | null {
  if (breedId === undefined) return null;
  return libraryBreed(breedId)?.growOutWeeks ?? null;
}

/**
 * The due row, anchored at the start of the window.
 *
 * At the start rather than the middle or the end, because the decision a
 * keeper is making is "book the processor" and that has a lead time. A row
 * that appeared when the window was already half gone would be information
 * arriving after it was useful.
 *
 * ## Something a farmer does has to clear it
 *
 * **This row used to be a permanent resident, and it was the only builder here
 * that was.** It read fields of the group and nothing else, so nothing a keeper
 * *did* could discharge it: a meat flock went `overdue` a day after the window
 * opened, sorted first on Today (`URGENCY_ORDER.overdue = 0`) in the alert
 * tint, and stayed there for ever. Processing the birds and recording the cull
 * changed nothing. The only escapes were lying about the group or archiving it.
 *
 * `due/types.ts` states the rule this broke outright — *"a list with a
 * permanent resident on it is a list people stop reading"* — and it is the
 * whole reason `careDues` counts from `careLog` and `shearingDues` from
 * `shearing`. This one had no equivalent record, so it never got one.
 *
 * The record is a `mortality` row with `cause: 'cull'`, which is what the loss
 * screen writes when the keeper says the birds were processed rather than lost.
 *
 * **Only a cull inside the window, and the first draft of this got it wrong.**
 * A bird put down for a bad leg is a `cull` too, so "any cull ever" would
 * silence the row before it had ever been shown. The obvious repair was to
 * count from the moment the row becomes visible — `opensAt - noticeDays` — and
 * a test written against a Cornish cross disproved it on the spot: `processing`
 * carries fourteen notice days against a six-week window, so "visible" is week
 * four, and a week-four injury is exactly the case being guarded against.
 *
 * So the line is `opensAt`. Before it the birds are not at processing weight by
 * the farm's own figure — that is what the window means — and a cull then is a
 * loss.
 *
 * **What that costs**, stated rather than hidden: a keeper who genuinely
 * processes early, before the window opens, is not answered and the row still
 * fires. The repair is `processAtWeeks`, which exists for exactly this — *"mine
 * are ready at eleven weeks"* — and which this file already argues is the farm
 * being the authority about the farm. A wrong figure corrected once is a better
 * answer than a rule that guesses.
 *
 * **The first cull in the window is enough.** A farm that takes twenty birds
 * this week and thirty next has had the information this row exists to deliver;
 * asking again is a different feature, and one nobody asked for.
 */
export function processingDue(
  group: GrowOutGroup,
  noticeDays = DEFAULT_NOTICE_DAYS.processing,
): Due | null {
  const window = growOutWindow(group);
  if (window === null) return null;

  if (group.lastCulledAt !== undefined && group.lastCulledAt >= window.opensAt) return null;

  return {
    key: `${group.id}:processing`,
    kind: 'processing',
    subject: { entity: 'flock', id: group.id },
    title: `${group.name} reach processing weight`,
    at: window.opensAt,
    atReading: null,
    projectedAt: null,
    noticeDays,
  };
}

/**
 * When this group starts laying, for a flock kept for eggs.
 *
 * The counterpart to the grow-out clock and the reason a new keeper stops
 * worrying in week fourteen: pullets come into lay at eighteen to twenty-two
 * weeks and not before, whatever the internet says about their feed.
 */
export function layOnsetWindow(group: GrowOutGroup): GrowOutWindow | null {
  if (!group.purposes?.includes('eggs')) return null;
  if (group.bornAt === undefined || group.breedId === undefined) return null;

  const weeks = libraryBreed(group.breedId)?.layOnsetWeeks;
  if (weeks === undefined) return null;

  return {
    opensAt: group.bornAt + weeks[0] * WEEK_MS,
    closesAt: group.bornAt + weeks[1] * WEEK_MS,
    weeks,
  };
}

/**
 * How much feed this group eats before a date, so a bag can be ordered rather
 * than discovered empty.
 *
 * Deliberately the plainest possible arithmetic — ration times head times
 * days. The interesting part is that it is only as good as the feed plan, and
 * a farm without one gets null rather than an estimate built on a guess about
 * how much a goat eats.
 */
export function feedNeededUg(
  perAnimalPerDayUg: number | null,
  headCount: number,
  days: number,
): number | null {
  if (perAnimalPerDayUg === null || perAnimalPerDayUg <= 0 || days <= 0) return null;
  return Math.round(perAnimalPerDayUg * headCount * days);
}
