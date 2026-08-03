import { beforeEach, describe, expect, it } from 'vitest';
import { newId, taskDues } from '@steading/contracts';
import { listTasks } from '@steading/core/read/tasks';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { JobsScreen } from '../../apps/mobile/src/screens/JobsScreen';
import { TodayScreen } from '../../apps/mobile/src/screens/TodayScreen';

/**
 * The one authored due kind.
 *
 * `DUE_KINDS` has listed `task` as "a chore the farm entered itself" since the
 * engine was written, and nothing could create one. Every row on Today was
 * derived from a record, so there was no way to say *fix the gate* — the one
 * thing every list app in the world can do.
 */

const DAY = 86_400_000;

beforeEach(async () => {
  await freshStore();
});

describe('writing a job down', () => {
  it('records it', async () => {
    const screen = await mount(<JobsScreen />);

    await screen.press('add-job');
    await screen.type('job-title', 'Fix the gate');
    await screen.press('save-job');
    screen.unmount();

    const [task] = await listTasks();
    expect(task).toMatchObject({ title: 'Fix the gate', recurrence: 'none' });
    expect(task?.dueAtDate).toBeDefined();
  });

  it('keeps one with no date off Today', async () => {
    const screen = await mount(<JobsScreen />);

    await screen.press('add-job');
    await screen.type('job-title', 'Replace the shed roof');
    await screen.press('job-dated');
    await screen.press('save-job');
    screen.unmount();

    const [task] = await listTasks();
    expect(task?.dueAtDate).toBeUndefined();

    // A job with no date is a note, not a job for this morning. Putting it on
    // Today for ever is how a list stops being read.
    expect(taskDues(task!)).toEqual([]);
  });
});

describe('a job on Today', () => {
  async function aJob(over: Record<string, unknown> = {}): Promise<string> {
    const id = newId();
    await enqueue({
      entity: 'task',
      op: 'create',
      targetId: id,
      payload: { title: 'Fix the gate', recurrence: 'none', dueAtDate: Date.now(), ...over },
    });
    return id;
  }

  it('appears there once it has a date', async () => {
    await aJob();

    const today = await mount(<TodayScreen />);
    expect(today.text()).toContain('Fix the gate');
    today.unmount();
  });

  /**
   * The completion flag the due engine refuses everywhere else, and the reason
   * it is right here: every other row is waiting for a record, and this one is
   * not. Fixing a gate produces nothing to log — the doing is the record — so
   * `completedAt` is not a second truth, it is the only one.
   */
  it('goes when it is done, and stays gone', async () => {
    const id = await aJob();

    const today = await mount(<TodayScreen />);
    await today.press(`due-done-${id}:task`);
    await today.press(`due-done-${id}:task`);
    today.unmount();

    const [task] = await listTasks();
    expect(task?.completedAt).toBeDefined();

    const after = await mount(<TodayScreen />);
    expect(after.text()).not.toContain('Fix the gate');
    after.unmount();
  });

  /**
   * A weekly job finished three days late is next due a week from Thursday,
   * not from the Monday nobody managed. Counting from the due date stacks up
   * overdue rows for a farm that is merely busy, and a list that accuses you
   * is one you stop opening.
   */
  it('comes back on its own interval, counted from when it was done', async () => {
    const done = Date.now();
    const dues = taskDues({
      id: 'a',
      title: 'Muck out',
      recurrence: 'weekly',
      // Due a fortnight ago and only done today.
      dueAtDate: done - 14 * DAY,
      completedAt: done,
    });

    expect(dues).toHaveLength(1);
    // Seven days from the doing, not twenty-one from the original date.
    expect(dues[0]?.at).toBe(done + 7 * DAY);
  });

  it('does not come back when it only happens once', () => {
    expect(
      taskDues({
        id: 'a',
        title: 'Fix the gate',
        recurrence: 'none',
        dueAtDate: Date.now() - DAY,
        completedAt: Date.now(),
      }),
    ).toEqual([]);
  });

  /** Pinned to a group, the row says which. */
  it('names its subject when it has one', () => {
    const [due] = taskDues(
      { id: 'a', title: 'Move to the top field', recurrence: 'none', dueAtDate: Date.now() },
      'The goats',
    );

    expect(due?.title).toBe('Move to the top field — The goats');
  });
});

describe('the jobs list', () => {
  it('finishes one from the list as well as from Today', async () => {
    await enqueue({
      entity: 'task',
      op: 'create',
      targetId: newId(),
      payload: { title: 'Ring the vet', recurrence: 'none', dueAtDate: Date.now() },
    });

    const screen = await mount(<JobsScreen />);
    const [task] = await listTasks();
    await screen.press(`job-${task!.id}`);
    screen.unmount();

    expect((await listTasks())[0]?.completedAt).toBeDefined();
  });

  it('invites rather than showing an empty page', async () => {
    const screen = await mount(<JobsScreen />);
    expect(screen.text()).toContain('Nothing written down');
    screen.unmount();
  });
});
