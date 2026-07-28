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
  if (group.bornAt === undefined || group.breedId === undefined) return null;

  const breed = libraryBreed(group.breedId);
  const weeks = breed?.growOutWeeks;
  if (weeks === undefined) return null;

  return {
    opensAt: group.bornAt + weeks[0] * WEEK_MS,
    closesAt: group.bornAt + weeks[1] * WEEK_MS,
    weeks,
  };
}

/**
 * The due row, anchored at the start of the window.
 *
 * At the start rather than the middle or the end, because the decision a
 * keeper is making is "book the processor" and that has a lead time. A row
 * that appeared when the window was already half gone would be information
 * arriving after it was useful.
 */
export function processingDue(
  group: GrowOutGroup,
  noticeDays = DEFAULT_NOTICE_DAYS.processing,
): Due | null {
  const window = growOutWindow(group);
  if (window === null) return null;

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
