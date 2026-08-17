import { taskCreateSchema } from '@steading/contracts';
import { localStore } from '../db/store';
import { newestTaskCompletions } from './completions';

/**
 * The chores a farm wrote down itself.
 *
 * The one authored kind. Everything else on Today is derived from a record —
 * a treatment implies a withdrawal, an hour reading implies a service — and
 * this is the escape hatch for the jobs that imply nothing: fix the gate, ring
 * the vet, order the wormer before Friday.
 */

export interface Task {
  id: string;
  title: string;
  recurrence: string;
  dueAtDate?: number;
  completedAt?: number;
  subjectId?: string;
  note?: string;
}

const stored = taskCreateSchema.partial();

export async function listTasks(): Promise<Task[]> {
  const [records, done] = await Promise.all([
    localStore().readRecordsByEntity('task'),
    /**
     * When each one was last actually done.
     *
     * `completedAt` is filled from the newest `taskCompletion` event, and from
     * the stored field only for a task that has none — every one written before
     * completions were events. Nothing downstream knows the difference:
     * `taskDues` counts recurrence from this field and `isSettled` reads it,
     * and neither changed. See `read/completions.ts` for why an event wins
     * outright rather than being compared with the field.
     */
    newestTaskCompletions(),
  ]);

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = stored.safeParse(record.value);
      if (!parsed.success || parsed.data.title === undefined) return [];

      const { title, recurrence, dueAtDate, subjectId, note } = parsed.data;
      const event = done.get(record.targetId);
      const completedAt = event === undefined ? parsed.data.completedAt : event.completedAt;

      // Named one at a time rather than spread, so the sort below can see
      // `dueAtDate`. A spread of `Object.fromEntries` widens to a bag of
      // unknowns and the optional fields stop existing as far as the compiler
      // is concerned.
      return [
        {
          id: record.targetId,
          title,
          // The schema defaults it, but a row written by an older build may
          // predate that — and `undefined` here would read as a broken task
          // rather than a one-off.
          recurrence: recurrence ?? 'none',
          ...(dueAtDate === undefined ? {} : { dueAtDate }),
          ...(completedAt === undefined ? {} : { completedAt }),
          ...(subjectId === undefined ? {} : { subjectId }),
          ...(note === undefined ? {} : { note }),
        } satisfies Task,
      ];
    })
    .sort((a, b) => (a.dueAtDate ?? Infinity) - (b.dueAtDate ?? Infinity));
}

/**
 * Whether a chore is finished for good.
 *
 * A recurring one is never finished — completing it moves the next occurrence
 * rather than closing the row, which is what `taskDues` does with the date.
 */
export function isSettled(task: Task): boolean {
  return task.completedAt !== undefined && task.recurrence === 'none';
}
