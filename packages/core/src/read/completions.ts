import { serviceCompletionCreateSchema, taskCompletionCreateSchema } from '@steading/contracts';
import { localStore } from '../db/store';

/**
 * Every time a job was actually done.
 *
 * ## Why this exists as a read rather than as a change to its callers
 *
 * `task.completedAt` and `maintenance.lastDoneAtDate` are fields each
 * completion overwrites, so the app could only ever remember the last one.
 * `entities/completions.ts` makes the completion an append-only event; this is
 * the half that lets everything already reading those fields go on doing it.
 *
 * `listTasks` and `listServices` fill the same field names from the newest
 * event, and fall back to the stored field when there is no event. So
 * `taskDues` still counts recurrence from `completedAt`, `isSettled` still asks
 * whether a one-off is finished, `serviceDue` still counts an interval from
 * `lastDoneAtHours` — and not one line of the due engine changed.
 *
 * ## Events win outright, rather than being merged with the field
 *
 * The obvious alternative is "whichever is later", and it breaks the thing this
 * change exists to enable. Un-completing a job is a `delete` of its newest
 * event; if a stale stored field could then win, deleting every event would
 * make a job somebody un-ticked look done again. So: if a record has any
 * completion events, they are the whole truth about it. The stored field is
 * consulted only for records that have none, which is every one written before
 * this existed.
 */

const storedTaskCompletion = taskCompletionCreateSchema.partial();
const storedServiceCompletion = serviceCompletionCreateSchema.partial();

export interface TaskCompletion {
  id: string;
  taskId: string;
  completedAt: number;
  note?: string;
}

export interface ServiceCompletion {
  id: string;
  serviceId: string;
  completedAt: number;
  atHours?: number;
  note?: string;
}

export async function listTaskCompletions(): Promise<TaskCompletion[]> {
  const records = await localStore().readRecordsByEntity('taskCompletion');

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = storedTaskCompletion.safeParse(record.value);
      if (!parsed.success) return [];

      const { taskId, completedAt, note } = parsed.data;
      if (taskId === undefined || completedAt === undefined) return [];

      return [{ id: record.targetId, taskId, completedAt, ...(note === undefined ? {} : { note }) }];
    })
    .sort((a, b) => b.completedAt - a.completedAt);
}

export async function listServiceCompletions(): Promise<ServiceCompletion[]> {
  const records = await localStore().readRecordsByEntity('serviceCompletion');

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = storedServiceCompletion.safeParse(record.value);
      if (!parsed.success) return [];

      const { serviceId, completedAt, atHours, note } = parsed.data;
      if (serviceId === undefined || completedAt === undefined) return [];

      return [
        {
          id: record.targetId,
          serviceId,
          completedAt,
          ...(atHours === undefined ? {} : { atHours }),
          ...(note === undefined ? {} : { note }),
        },
      ];
    })
    .sort((a, b) => b.completedAt - a.completedAt);
}

/**
 * The newest completion against each subject.
 *
 * Both lists are already newest-first, so the first one seen for a subject wins
 * and nothing has to compare dates twice.
 */
export function newestBy<T extends { completedAt: number }>(
  events: readonly T[],
  subjectOf: (event: T) => string,
): Map<string, T> {
  const newest = new Map<string, T>();
  for (const event of events) {
    const subject = subjectOf(event);
    const held = newest.get(subject);
    if (held === undefined || event.completedAt > held.completedAt) newest.set(subject, event);
  }
  return newest;
}

/** The newest completion of each task, and of each service schedule. */
export async function newestTaskCompletions(): Promise<Map<string, TaskCompletion>> {
  return newestBy(await listTaskCompletions(), (event) => event.taskId);
}

export async function newestServiceCompletions(): Promise<Map<string, ServiceCompletion>> {
  return newestBy(await listServiceCompletions(), (event) => event.serviceId);
}
