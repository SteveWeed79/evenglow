import { DEFAULT_NOTICE_DAYS } from './notice';
import type { Due } from './types';

/**
 * A chore the farm entered itself.
 *
 * `DUE_KINDS` has listed `task` as "the one authored kind" since the engine
 * was written, and nothing could create one — every row on Today was derived
 * from a record, and there was no way to say *fix the gate*.
 *
 * ## Why this one is allowed a completion flag
 *
 * The due engine's third property refuses stored completion, and the reasoning
 * is that a flag is a second source of truth that drifts from the records. It
 * does not apply here, and the difference is exact: **every other row is
 * waiting for a record, and this one is not.** A service clears because a
 * service was logged. A hatch clears because the hatch was recorded. Fixing
 * the gate produces nothing to log — the doing *is* the record — so
 * `completedAt` on the task is not a second truth, it is the only one.
 *
 * That is why `completedAt` has been in `taskShape` since the schema was
 * written. This reads it.
 *
 * ## Recurrence counts from when it was done, not when it was due
 *
 * A weekly job finished three days late is next due a week from Thursday, not
 * from the Monday nobody managed. Counting from the due date would stack up
 * overdue rows for a farm that is merely busy, and a list that accuses you is
 * one you stop opening.
 *
 * The same rule `careDues` uses for husbandry, for the same reason.
 */

const DAY_MS = 86_400_000;

/** Days between occurrences. `null` means it happens once. */
const EVERY: Record<string, number | null> = {
  none: null,
  daily: 1,
  weekly: 7,
  // Thirty rather than a calendar month: a chore is not an invoice, and
  // "about a month" is what somebody means when they pick it.
  monthly: 30,
};

export interface TaskRecord {
  id: string;
  title: string;
  recurrence: string;
  dueAtDate?: number | undefined;
  completedAt?: number | undefined;
  subjectId?: string | undefined;
  note?: string | undefined;
}

/**
 * The row one chore produces, or none.
 *
 * A task with no date is deliberately not a due row. Somebody who wrote down
 * *replace the shed roof* without saying when has made a note, not a job for
 * this morning, and putting it on Today for ever is how a list stops being
 * read. It is still on the Jobs screen.
 */
export function taskDues(task: TaskRecord, subjectName?: string): Due[] {
  if (task.dueAtDate === undefined) return [];

  const every = EVERY[task.recurrence] ?? null;

  // Done, and never coming back.
  if (task.completedAt !== undefined && every === null) return [];

  const at =
    task.completedAt === undefined ? task.dueAtDate : task.completedAt + every! * DAY_MS;

  return [
    {
      key: `${task.id}:task`,
      kind: 'task',
      subject: { entity: 'task', id: task.id },
      title: subjectName === undefined ? task.title : `${task.title} — ${subjectName}`,
      at,
      atReading: null,
      projectedAt: null,
      noticeDays: DEFAULT_NOTICE_DAYS.task,
      /**
       * One press finishes it, and for this kind that is the whole of it.
       *
       * The test `Due.done` sets — does the press write everything the form
       * would have collected? — is trivially passed here: the form collects a
       * title and a date, both of which already exist. There is nothing left
       * to ask.
       */
      done: {
        entity: 'task',
        op: 'update',
        targetId: task.id,
        payload: {},
        stampAs: 'completedAt',
        label: 'Done',
      },
    },
  ];
}
