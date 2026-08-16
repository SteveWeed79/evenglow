import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { listHistory } from '@steading/core/read/history';
import { listTasks } from '@steading/core/read/tasks';
import { enqueue } from '@steading/core/sync/queue';
import { localStore } from '@steading/core/db/store';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { JobsScreen } from '../../apps/mobile/src/screens/JobsScreen';

/**
 * A finished job, and where it goes.
 *
 * Reported from a farm: *"Jobs list needs to be more clear on items that have
 * been completed. Completed items should semi lock behind a 'Need to redo
 * this' kinda thing. Completed jobs should disappear from the list and go to
 * storage overnight."*
 *
 * Three problems in one report, and they compound:
 *
 *  1. A finished job rendered as an ordinary row **with a chevron** — the
 *     mark this app uses to promise "this opens something". It opened nothing.
 *  2. A single tap on it silently un-finished the job. The two lies together
 *     meant the control that looked most like a detail view was the one that
 *     undid the work.
 *  3. They accumulated for ever, so a farm that had used the app for a season
 *     scrolled a graveyard to reach the jobs it still had to do.
 *
 * Letting go of them overnight is only safe because they land somewhere, which
 * is the fourth change: `task` reaches the history projection now.
 */

const DAY = 86_400_000;

async function aJob(title: string): Promise<string> {
  const id = newId();
  await enqueue({
    entity: 'task',
    op: 'create',
    targetId: id,
    payload: { title, recurrence: 'none', dueAtDate: Date.now() },
  });
  return id;
}

/** Finished at a given moment, which is how "overnight" is tested. */
async function finishedAt(id: string, at: number): Promise<void> {
  await enqueue({ entity: 'task', op: 'update', targetId: id, payload: { completedAt: at } });
}

beforeEach(async () => {
  await freshStore();
});

describe('a job finished today', () => {
  it('reads as finished, with the time it was done', async () => {
    const id = await aJob('Fix the gate');
    await finishedAt(id, Date.now());

    const screen = await mount(<JobsScreen />);

    expect(screen.has(`job-done-${id}`)).toBe(true);
    expect(screen.text()).toContain('Done today');
    // `text()` joins string nodes with a space, so "Done {time}" arrives as
    // "Done  at 3:01 PM". That is the harness, not the screen.
    expect(screen.text().replace(/\s+/g, ' ')).toContain('Done at');
    screen.unmount();
  });

  /**
   * The control that undid the work by being tapped. A finished job is not
   * pressable at all now — reopening is its own deliberate act.
   */
  it('cannot be un-finished by tapping it', async () => {
    const id = await aJob('Fix the gate');
    await finishedAt(id, Date.now());

    const screen = await mount(<JobsScreen />);
    const row = screen.get(`job-done-${id}`);

    expect(row.props.onPress).toBeUndefined();
    screen.unmount();

    expect((await listTasks())[0]?.completedAt).toBeDefined();
  });

  /** And reopening takes two deliberate presses, like every other undo here. */
  it('goes back on the list through "Need to redo this", and only on the second press', async () => {
    const id = await aJob('Fix the gate');
    await finishedAt(id, Date.now());

    const screen = await mount(<JobsScreen />);

    await screen.press(`job-redo-${id}`);
    expect((await listTasks())[0]?.completedAt).toBeDefined();

    await screen.press(`job-redo-${id}`);
    screen.unmount();

    expect((await listTasks())[0]?.completedAt).toBeUndefined();
  });

  /**
   * And the undo has to leave the handset.
   *
   * This button wrote `{ completedAt: undefined }`, which cleared the local
   * record — the test above passed the whole time — and never reached the
   * server: `JSON.stringify` drops the key, so `$set` left `completedAt`
   * standing and every other device on the farm went on showing the job done.
   * The one assertion that tells the two apart is what the payload looks like
   * after a round trip through JSON. See `contracts/clearing.ts`.
   */
  it('sends the undo as a null, so the farm’s other devices get it too', async () => {
    const id = await aJob('Fix the gate');
    await finishedAt(id, Date.now());

    const screen = await mount(<JobsScreen />);
    await screen.press(`job-redo-${id}`);
    await screen.press(`job-redo-${id}`);
    screen.unmount();

    const outbox = await localStore().readOutboxBySeq();
    const undo = outbox.filter((m) => m.entity === 'task' && m.op === 'update').pop();
    const onTheWire = JSON.parse(JSON.stringify(undo?.payload)) as Record<string, unknown>;

    expect(onTheWire).toHaveProperty('completedAt');
    expect(onTheWire.completedAt).toBeNull();
  });

  /** Where they go, said before they go, so tomorrow is not a surprise. */
  it('says that it clears overnight', async () => {
    const id = await aJob('Fix the gate');
    await finishedAt(id, Date.now());

    const screen = await mount(<JobsScreen />);
    expect(screen.text()).toContain('clear overnight');
    screen.unmount();
  });
});

describe('a job finished before today', () => {
  it('is gone from the list', async () => {
    const id = await aJob('Ring the vet');
    await finishedAt(id, Date.now() - 2 * DAY);

    const screen = await mount(<JobsScreen />);

    expect(screen.has(`job-done-${id}`)).toBe(false);
    expect(screen.text()).not.toContain('Ring the vet');
    screen.unmount();
  });

  /**
   * And is not lost, which is the whole reason letting go of it is safe. This
   * is the assertion the report's "goto storage" was really about.
   */
  it('is in What happened, on the day it was done', async () => {
    const id = await aJob('Ring the vet');
    const done = Date.now() - 2 * DAY;
    await finishedAt(id, done);

    const history = await listHistory('imperial');
    const day = history.find((entry) => entry.events.some((one) => one.title === 'Ring the vet'));

    expect(day).toBeDefined();
    expect(day?.events.find((one) => one.title === 'Ring the vet')?.at).toBe(done);
    expect(day?.summary).toContain('job');
  });

  /** A job still to do is not history — it has not happened. */
  it('keeps an unfinished job out of What happened', async () => {
    await aJob('Replace the shed roof');

    const history = await listHistory('imperial');
    const found = history.some((day) =>
      day.events.some((one) => one.title === 'Replace the shed roof'),
    );

    expect(found).toBe(false);
  });
});

describe('a job still to do', () => {
  it('stays on the list, and is the thing the screen is about', async () => {
    const open = await aJob('Fix the gate');
    const shut = await aJob('Ring the vet');
    await finishedAt(shut, Date.now() - 2 * DAY);

    const screen = await mount(<JobsScreen />);

    expect(screen.has(`job-${open}`)).toBe(true);
    expect(screen.text()).toContain('Fix the gate');
    screen.unmount();
  });
});
