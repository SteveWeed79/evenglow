import { libraryBreed } from '../library';
import type { Species } from '../entities/livestock';
import type { Due } from './types';

/**
 * The clip, as a date.
 *
 * ## A number that was already in the app and read by nothing
 *
 * `fibreIntervalMonths` has been on the breed library since it was written —
 * six months on an Angora, twelve on a Merino, twenty-four on a llama, and
 * deliberately absent on the Wiltshire Horn because a hair sheep sheds its own
 * coat and is never shorn. Eleven breeds carry it. Nothing derived a single row
 * from it, so a farm keeping fibre got a screen to record a clip and no
 * reminder that one was owed.
 *
 * That is the gap the app's own rule is about: a feature is not the schema, it
 * is the schema plus the thing that reads it.
 *
 * ## Why this is not a `careLog` kind
 *
 * Worming and foot trimming are `task` rows that a single press can honestly
 * complete, because the record is a date and a subject. A clip is not: the
 * greasy weight is the entire point of recording it, and a season's yield is
 * the number a fibre farm keeps records FOR. A one-press "Shorn" would write a
 * record with no weight in it and clear the row that would have asked for one.
 *
 * So `done` is deliberately absent, which is the same reason a hatch and a
 * service do not have one. The row sends somebody to the form.
 *
 * ## Absent means never, and that is a real answer
 *
 * A breed with no interval is not a breed on a default schedule — it is a hair
 * sheep, or a breed whose fibre nobody harvests. Guessing twelve months at it
 * would put a permanent unclearable row on a farm that will never shear, which
 * is precisely how a list stops being read.
 *
 * A group with no breed set gets nothing either. The honest answer to "how
 * often should this be shorn" for an unnamed breed is that the app does not
 * know, and a farm that wants the reminder can name the breed.
 */

export interface FibreGroup {
  id: string;
  name: string;
  species: Species;
  /** From the library. Absent means the farm never said which breed. */
  breedId?: string | undefined;
  /** What the farm keeps them for. Shearing is offered only where fibre is. */
  purposes?: readonly string[] | undefined;
  /** When they were last shorn. Absent means never, or never recorded. */
  lastShornAt?: number | undefined;
  /** When this farm added the group, from the ULID in its id. */
  since?: number | undefined;
}

const DAY_MS = 86_400_000;

/** Months are not 30 days, but a shearing interval is not a precise date. */
const DAYS_PER_MONTH = 30.44;

/**
 * Six weeks.
 *
 * Far longer than husbandry's fortnight, because a clip is not a job somebody
 * does on a whim: a shearer is booked, and in spring they are booked out. Six
 * weeks is enough notice to get on a round.
 */
const NOTICE_DAYS = 42;

/**
 * A never-recorded clip is due a month after the group was added.
 *
 * Longer than husbandry's week, and for a different reason. Worming has an
 * honest answer within days — either it happened or it did not. A farm that
 * has just added an alpaca has no way to say "shorn last April" except by
 * back-dating a clip, and a red row on the first morning for a job that is
 * genuinely not owed until next spring teaches somebody to ignore the list.
 */
const GRACE_DAYS = 30;

/**
 * How often this group is shorn, in days, or null if it never is.
 *
 * Read from the breed rather than the species: a Merino is a twelve-month
 * fleece and a Wiltshire Horn is not shorn at all, and both are sheep. The
 * species is the wrong grain for this one question.
 */
export function shearIntervalDays(breedId: string | undefined): number | null {
  if (breedId === undefined) return null;

  const breed = libraryBreed(breedId);
  const months = breed?.fibreIntervalMonths;
  if (months === undefined || months <= 0) return null;

  return Math.round(months * DAYS_PER_MONTH);
}

/** The clip owed on one group, if one is owed at all. */
export function shearingDues(group: FibreGroup, now: number): Due[] {
  // Kept for fibre, said by the farm. A Romney kept purely for meat has a
  // fleece and the farm has said it is not what they are for.
  if (!(group.purposes ?? []).includes('fibre')) return [];

  const days = shearIntervalDays(group.breedId);
  if (days === null) return [];

  const never = (group.since ?? now) + GRACE_DAYS * DAY_MS;

  return [
    {
      key: `${group.id}:shearing`,
      kind: 'shearing',
      subject: { entity: 'flock', id: group.id },
      title: `Shearing — ${group.name}`,
      at: group.lastShornAt === undefined ? never : group.lastShornAt + days * DAY_MS,
      atReading: null,
      projectedAt: null,
      noticeDays: NOTICE_DAYS,
      // No `done`. The weight is the point of the record — see the note above.
    },
  ];
}
