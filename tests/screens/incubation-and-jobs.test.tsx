import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { listHistory } from '@homefarm/core/read/history';
import { listTasks } from '@homefarm/core/read/tasks';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { GroupScreen } from '../../apps/mobile/src/screens/GroupScreen';
import { IncubationScreen } from '../../apps/mobile/src/screens/IncubationScreen';
import { JobsScreen } from '../../apps/mobile/src/screens/JobsScreen';

/**
 * The two screens the due engine had not reached, and they wanted opposite
 * things.
 *
 * **A set of eggs is a detail screen** and took the panel: its two steps are
 * dated, and until now the screen stated those dates in plain muted prose with
 * no notion of late, so a set four days past its hatch read exactly like one due
 * next week.
 *
 * **Jobs is the task list itself**, so a panel of the same rows above the same
 * rows would be Today with a different heading. What it lacked was the engine's
 * sense of time, which it had been reimplementing worse — and a way to set the
 * one field that would put a chore on something else's screen.
 */

const DAY = 86_400_000;

const GROUP = newId();
const EGGS = newId();

async function theHens(): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
  });
}

/** A set under for `days`, from this farm's own hens. */
async function aSet(days: number, over: Record<string, unknown> = {}): Promise<void> {
  await enqueue({
    entity: 'incubation',
    op: 'create',
    targetId: EGGS,
    payload: {
      species: 'chicken',
      flockId: GROUP,
      label: 'Sussex',
      setAt: Date.now() - days * DAY,
      eggsSet: 12,
      source: 'own',
      method: 'incubator',
      ...over,
    },
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

describe('a set of eggs somebody has not candled', () => {
  /**
   * Candling is due about day seven of twenty-one. At day twelve the panel
   * below still reads "Due about 3 September", which is a date rather than a
   * verdict — `urgencyOf` is what knows it went by.
   */
  it('says how late the candling is, which the form’s date cannot', async () => {
    await theHens();
    await aSet(12);

    const screen = await mount(<IncubationScreen {...routeProps({ incubationId: EGGS })} />);

    expect(screen.text()).toContain('Candle the Sussex eggs');
    expect(screen.text()).toContain('days ago');
    screen.unmount();
  });

  /**
   * A candle row opens the Incubation screen, which is this one. `here` drops
   * the tap and `DueRow` draws the unpressable branch as `accessibilityRole:
   * 'text'` — the form beneath is where the step is actually discharged.
   */
  it('is not a door back to the screen it is already on', async () => {
    await theHens();
    await aSet(12);

    const screen = await mount(<IncubationScreen {...routeProps({ incubationId: EGGS })} />);

    expect(screen.get(`due-${EGGS}:candle`).props.accessibilityRole).toBe('text');
    screen.unmount();
  });

  it('has nothing to say once both steps are recorded', async () => {
    await theHens();
    await aSet(30);
    await enqueue({
      entity: 'incubation',
      op: 'update',
      targetId: EGGS,
      payload: { candledAt: Date.now() - 23 * DAY, fertile: 10, hatchedAt: Date.now(), hatched: 8 },
    });

    const screen = await mount(<IncubationScreen {...routeProps({ incubationId: EGGS })} />);

    expect(screen.text()).toContain('Nothing is due for this');
    screen.unmount();
  });
});

/**
 * The hole the panel found: `read/history.ts` was blind to incubations
 * entirely, so one of the few events on a poultry year anybody remembers the
 * date of appeared nowhere but the set's own screen.
 */
describe('a hatch', () => {
  it('lands in what happened, with what came out of it', async () => {
    await theHens();
    await aSet(21);
    await enqueue({
      entity: 'incubation',
      op: 'update',
      targetId: EGGS,
      payload: { hatchedAt: Date.now(), hatched: 8, earlyLosses: 1 },
    });

    const days = await listHistory();
    const event = days.flatMap((day) => day.events).find((e) => e.entity === 'incubation');

    expect(event?.title).toBe('Sussex eggs hatched');
    expect(event?.detail).toContain('8 chicks');
    expect(event?.detail).toContain('from 12 eggs set');
    expect(event?.detail).toContain('1 lost in the first days');
  });

  /** It is the hens' hatch as well as the set's — they laid the eggs. */
  it('is on the timeline of the group the eggs came from', async () => {
    await theHens();
    await aSet(21);
    await enqueue({
      entity: 'incubation',
      op: 'update',
      targetId: EGGS,
      payload: { hatchedAt: Date.now(), hatched: 8 },
    });

    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);

    expect(screen.text()).toContain('Sussex eggs hatched');
    screen.unmount();
  });

  /** Only the hatch. A candling is a step in the middle, not an outcome. */
  it('does not put a candling in the farm’s history', async () => {
    await theHens();
    await aSet(8);
    await enqueue({
      entity: 'incubation',
      op: 'update',
      targetId: EGGS,
      payload: { candledAt: Date.now(), fertile: 10 },
    });

    const days = await listHistory();

    expect(days.flatMap((day) => day.events).some((e) => e.entity === 'incubation')).toBe(false);
  });
});

describe('a job nobody has done', () => {
  it('says how late it is rather than printing a date', async () => {
    await aJob({ dueAtDate: Date.now() - 5 * DAY });

    const screen = await mount(<JobsScreen />);

    expect(screen.text()).toContain('Was due 5 days ago');
    screen.unmount();
  });

  /**
   * `listTasks` orders by `dueAtDate`, which for a weekly chore finished
   * yesterday is the Monday it started from rather than next Thursday.
   * `taskDues` computes the next occurrence and the list sorts on that.
   */
  it('sorts a recurring job by its next turn, not the date it started from', async () => {
    // Started a month ago, done yesterday — so next due in six days.
    await aJob({
      title: 'Check the fences',
      recurrence: 'weekly',
      dueAtDate: Date.now() - 30 * DAY,
      completedAt: Date.now() - DAY,
    });
    await aJob({ title: 'Ring the vet', dueAtDate: Date.now() });

    const screen = await mount(<JobsScreen />);
    const text = screen.text();
    screen.unmount();

    expect(text.indexOf('Ring the vet')).toBeLessThan(text.indexOf('Check the fences'));
  });
});

/**
 * `taskShape.subjectId` has existed since the schema was written, `useDues`
 * reads it, `Due.about` carries it, and nothing in the app could set it — so
 * the path that puts a chore on a group's own screen was reachable only from a
 * test.
 */
describe('a job pinned to something', () => {
  it('records what it is for, and says so on the row', async () => {
    await theHens();

    const screen = await mount(<JobsScreen />);
    await screen.press('add-job');
    await screen.type('job-title', 'Order the wormer');
    await screen.press(`job-for-${GROUP}`);
    await screen.press('save-job');
    screen.unmount();

    const [task] = await listTasks();
    expect(task?.subjectId).toBe(GROUP);

    const after = await mount(<JobsScreen />);
    expect(after.text()).toContain('The hens');
    after.unmount();
  });

  /** And the whole reason for it: the group's own screen now carries the job. */
  it('shows up on that group’s screen', async () => {
    await theHens();
    await enqueue({
      entity: 'task',
      op: 'create',
      targetId: newId(),
      payload: {
        title: 'Order the wormer',
        recurrence: 'none',
        dueAtDate: Date.now() + 14 * DAY,
        subjectId: GROUP,
      },
    });

    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);

    expect(screen.text()).toContain('Order the wormer');
    screen.unmount();
  });

  /** A farm with nothing to pin to is not asked a question with one answer. */
  it('is not offered on a farm with no groups and no machines', async () => {
    const screen = await mount(<JobsScreen />);
    await screen.press('add-job');

    expect(screen.text()).not.toContain('What is it for?');
    expect(screen.has('job-for-farm')).toBe(false);
    screen.unmount();
  });
});
