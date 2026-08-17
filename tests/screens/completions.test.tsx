import { beforeEach, describe, expect, it } from 'vitest';
import { newId, serviceDue } from '@steading/contracts';
import { listServiceCompletions, listTaskCompletions } from '@steading/core/read/completions';
import { listHistory } from '@steading/core/read/history';
import { listServices } from '@steading/core/read/iron';
import { listTasks } from '@steading/core/read/tasks';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { JobsScreen } from '../../apps/mobile/src/screens/JobsScreen';
import { ServiceDoneScreen } from '../../apps/mobile/src/screens/ServiceDoneScreen';
import { TodayScreen } from '../../apps/mobile/src/screens/TodayScreen';

/**
 * Doing a job, as an event rather than a field.
 *
 * `task.completedAt` and `maintenance.lastDoneAtDate` were single values each
 * completion overwrote, so the app could only ever remember the last time. A
 * machine serviced every spring for six years showed one date, and
 * `Steading-Masterplan.md` advertises a service record to hand over with a
 * tractor that could not be produced from it. `read/history.ts` stated the
 * limitation twice, once against each entity, and named the fix: *"an
 * append-only completion record — the shape `careLog` already is for animals."*
 *
 * Two properties hold this together and each has a block below.
 *
 * **Every occurrence survives**, which is the point.
 *
 * **Nothing reading the old field names had to change.** `listTasks` and
 * `listServices` fill `completedAt`, `lastDoneAtDate` and `lastDoneAtHours`
 * from the newest event, so `taskDues`, `isSettled` and `serviceDue` did not
 * lose a line between them — and a farm's existing records, which have the
 * fields and no events, go on reading exactly as they did.
 */

const DAY = 86_400_000;

const MACHINE = newId();
const SCHEDULE = newId();

async function aTractor(over: Record<string, unknown> = {}): Promise<void> {
  await enqueue({
    entity: 'equipment',
    op: 'create',
    targetId: MACHINE,
    payload: { name: 'The tractor' },
  });
  await enqueue({
    entity: 'maintenance',
    op: 'create',
    targetId: SCHEDULE,
    payload: { equipmentId: MACHINE, title: 'Oil and filter', intervalDays: 365, ...over },
  });
}

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

beforeEach(async () => {
  await freshStore();
});

describe('a job done more than once', () => {
  /**
   * The limitation the `task` history builder states in its own comment: *"a
   * recurring job overwrites its own `completedAt` each time, so history shows
   * the LAST time it was done rather than every time."*
   */
  it('leaves a row for every time, not only the last', async () => {
    await aJob({ title: 'Check the fences', recurrence: 'weekly' });

    const screen = await mount(<JobsScreen />);
    const [task] = await listTasks();

    await screen.press(`job-${task!.id}`);
    await screen.press(`job-${task!.id}`);
    await screen.press(`job-${task!.id}`);
    screen.unmount();

    expect(await listTaskCompletions()).toHaveLength(3);

    const events = (await listHistory()).flatMap((day) => day.events);
    expect(events.filter((event) => event.entity === 'taskCompletion')).toHaveLength(3);
  });

  /**
   * And the recurrence still counts from the newest of them, which is the
   * assertion that proves `taskDues` needed no change: it reads `completedAt`
   * exactly as it always did.
   */
  it('still counts its next turn from the last time it was done', async () => {
    const id = await aJob({
      title: 'Check the fences',
      recurrence: 'weekly',
      dueAtDate: Date.now() - 30 * DAY,
    });

    const screen = await mount(<JobsScreen />);
    await screen.press(`job-${id}`);
    screen.unmount();

    const [task] = await listTasks();
    // Filled from the event, under the name the engine has always read.
    expect(task?.completedAt).toBeGreaterThan(Date.now() - DAY);
  });
});

/**
 * `JobsScreen`'s *Need to redo this* wrote `{ completedAt: null }` —
 * `APPROVED-WORK.md` §1 names it as one of two live symptoms of the clearing
 * defect. Against an event there is nothing to clear.
 */
describe('putting a job back', () => {
  it('deletes the completion rather than clearing a field', async () => {
    const id = await aJob();

    const screen = await mount(<JobsScreen />);
    await screen.press(`job-${id}`);
    expect((await listTasks())[0]?.completedAt).toBeDefined();

    await screen.press(`job-redo-${id}`);
    await screen.press(`job-redo-${id}`);
    screen.unmount();

    expect(await listTaskCompletions()).toEqual([]);
    expect((await listTasks())[0]?.completedAt).toBeUndefined();
  });

  /** Only the newest, because a job done before has several. */
  it('puts back the one just done and leaves the rest', async () => {
    const id = await aJob();

    const screen = await mount(<JobsScreen />);
    await screen.press(`job-${id}`);
    screen.unmount();

    // An older finishing, recorded directly so the two cannot share a moment.
    await enqueue({
      entity: 'taskCompletion',
      op: 'create',
      targetId: newId(),
      payload: { taskId: id, completedAt: Date.now() - 7 * DAY },
    });

    const again = await mount(<JobsScreen />);
    await again.press(`job-redo-${id}`);
    await again.press(`job-redo-${id}`);
    again.unmount();

    const left = await listTaskCompletions();
    expect(left).toHaveLength(1);
    expect(left[0]?.completedAt).toBeLessThan(Date.now() - DAY);
  });

  /**
   * A job finished by a build that predates this has a stored field and no
   * event, and it must still be possible to put back — which is exactly what
   * the clearing contract was built for, so the null stays for that case.
   */
  it('still clears the old field on a job finished before events existed', async () => {
    const id = await aJob({ completedAt: Date.now() });

    const screen = await mount(<JobsScreen />);
    await screen.press(`job-redo-${id}`);
    await screen.press(`job-redo-${id}`);
    screen.unmount();

    expect((await listTasks())[0]?.completedAt).toBeUndefined();
  });
});

describe('a machine serviced more than once', () => {
  it('keeps every service, which is the record you hand over with it', async () => {
    await aTractor();

    for (let i = 0; i < 2; i += 1) {
      const screen = await mount(<ServiceDoneScreen {...routeProps({ serviceId: SCHEDULE })} />);
      await screen.press('save-done');
      screen.unmount();
    }

    expect(await listServiceCompletions()).toHaveLength(2);

    const events = (await listHistory()).flatMap((day) => day.events);
    const serviced = events.filter((event) => event.entity === 'serviceCompletion');
    expect(serviced).toHaveLength(2);
    expect(serviced[0]?.title).toBe('Oil and filter — The tractor');
    // Hung on the machine, so it is on the machine's own timeline beside the
    // hour readings.
    expect(serviced[0]?.subjects).toEqual([MACHINE]);
  });

  /**
   * `serviceDue` counts an hours interval from `lastDoneAtHours` and did not
   * change. The reading now arrives from the newest event under the same name.
   */
  it('still counts the next interval from the last reading', async () => {
    await enqueue({
      entity: 'equipment',
      op: 'create',
      targetId: MACHINE,
      payload: { name: 'The tractor', hasHourMeter: true },
    });
    await enqueue({
      entity: 'maintenance',
      op: 'create',
      targetId: SCHEDULE,
      payload: { equipmentId: MACHINE, title: 'Oil and filter', intervalHours: 100 },
    });
    await enqueue({
      entity: 'hourReading',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now(), equipmentId: MACHINE, hours: 110 },
    });

    const screen = await mount(<ServiceDoneScreen {...routeProps({ serviceId: SCHEDULE })} />);
    await screen.press('save-done');
    screen.unmount();

    const [schedule] = await listServices();
    expect(schedule?.lastDoneAtHours).toBe(110);

    const due = serviceDue(
      { id: MACHINE, name: 'The tractor', hasHourMeter: true, hours: 110, usagePerDay: null },
      {
        id: SCHEDULE,
        name: 'Oil and filter',
        everyHours: 100,
        lastDoneAtHours: schedule?.lastDoneAtHours,
      },
      Date.now(),
    );
    expect(due?.atReading).toBe(210);
  });

  /**
   * A date from this spring beside a meter reading from two services ago is a
   * pair that never happened, and `serviceDue` would count from it.
   */
  it('takes the date and the reading from the same service', async () => {
    await enqueue({
      entity: 'equipment',
      op: 'create',
      targetId: MACHINE,
      payload: { name: 'The tractor', hasHourMeter: true },
    });
    await enqueue({
      entity: 'maintenance',
      op: 'create',
      targetId: SCHEDULE,
      payload: {
        equipmentId: MACHINE,
        title: 'Oil and filter',
        intervalHours: 100,
        // A service from a build that predates events.
        lastDoneAtDate: Date.now() - 400 * DAY,
        lastDoneAtHours: 250,
      },
    });
    // A newer one, on a machine whose meter nobody has read since.
    await enqueue({
      entity: 'serviceCompletion',
      op: 'create',
      targetId: newId(),
      payload: { serviceId: SCHEDULE, completedAt: Date.now() },
    });

    const [schedule] = await listServices();

    expect(schedule?.lastDoneAtDate).toBeGreaterThan(Date.now() - DAY);
    // Not 250, which belonged to the service four hundred days ago.
    expect(schedule?.lastDoneAtHours).toBeUndefined();
  });
});

/**
 * A farm's existing records are the only place the old completions live, so the
 * legacy readers stay — and must not double-count once a record has events.
 */
describe('records written before completions were events', () => {
  it('still read as done, and still appear in history once', async () => {
    await aJob({ completedAt: Date.now() });
    await aTractor({ lastDoneAtDate: Date.now(), lastDoneAtHours: 250 });

    expect((await listTasks())[0]?.completedAt).toBeDefined();
    expect((await listServices())[0]?.lastDoneAtHours).toBe(250);

    const events = (await listHistory()).flatMap((day) => day.events);
    expect(events.filter((e) => e.entity === 'task')).toHaveLength(1);
    expect(events.filter((e) => e.entity === 'maintenance')).toHaveLength(1);
  });

  /**
   * The double-count this guards against: the legacy row shows the last
   * completion, and so does the newest event, so both would appear for the same
   * job on the same day.
   */
  it('give up their history row once the record has events', async () => {
    const id = await aJob({ completedAt: Date.now() - 30 * DAY });
    await aTractor({ lastDoneAtDate: Date.now() - 30 * DAY });

    await enqueue({
      entity: 'taskCompletion',
      op: 'create',
      targetId: newId(),
      payload: { taskId: id, completedAt: Date.now() },
    });
    await enqueue({
      entity: 'serviceCompletion',
      op: 'create',
      targetId: newId(),
      payload: { serviceId: SCHEDULE, completedAt: Date.now() },
    });

    const events = (await listHistory()).flatMap((day) => day.events);

    expect(events.filter((e) => e.entity === 'task')).toEqual([]);
    expect(events.filter((e) => e.entity === 'maintenance')).toEqual([]);
    expect(events.filter((e) => e.entity === 'taskCompletion')).toHaveLength(1);
    expect(events.filter((e) => e.entity === 'serviceCompletion')).toHaveLength(1);
  });
});

/** The Done button on Today writes the same event the Jobs list does. */
describe('the Done button on a due row', () => {
  it('records a completion rather than stamping the task', async () => {
    const id = await aJob({ title: 'Ring the vet' });

    // The row itself goes nowhere — a task has no screen of its own — so this
    // is the Done button on it, armed and then confirmed.
    const screen = await mount(<TodayScreen />);
    await screen.press(`due-done-${id}:task`);
    await screen.press(`due-done-${id}:task`);
    screen.unmount();

    const done = await listTaskCompletions();
    expect(done).toHaveLength(1);
    expect(done[0]?.taskId).toBe(id);
  });
});
