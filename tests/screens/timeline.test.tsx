import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { listHistory } from '@steading/core/read/history';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { Timeline } from '../../apps/mobile/src/components/Timeline';
import { GroupScreen } from '../../apps/mobile/src/screens/GroupScreen';
import { MachineScreen } from '../../apps/mobile/src/screens/MachineScreen';

/**
 * The half that makes a detail screen worth opening.
 *
 * The assessment's best single idea was one reusable detail-and-timeline
 * screen: several entities stop at creation and a static list, and what is
 * missing from each of them is the same thing — what actually happened to this
 * animal, this machine, this planting. Three screens showed a subject's
 * *state* and none of them showed its *story*.
 *
 * The panel is the reusable half. Its rows are `HistoryScreen`'s own, shared
 * rather than copied, because taking a record back has to behave identically
 * whichever container it is in.
 */

const GROUP = newId();
const MACHINE = newId();
const DAY = 86_400_000;

async function theHens(): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
  });
}

async function eggsToday(count: number): Promise<string> {
  const id = newId();
  await enqueue({
    entity: 'eggLog',
    op: 'create',
    targetId: id,
    payload: { occurredAt: Date.now(), flockId: GROUP, count },
  });
  return id;
}

beforeEach(async () => {
  await freshStore();
  await theHens();
});

describe('a subject with a story', () => {
  it('shows what was logged against it', async () => {
    await eggsToday(12);

    const screen = await mount(<Timeline subject={GROUP} />);

    expect(screen.text()).toContain('12 eggs');
    screen.unmount();
  });

  it('shows nothing belonging to anything else', async () => {
    await eggsToday(12);

    const other = newId();
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: other,
      payload: { name: 'The goats', species: 'goat', count: 3 },
    });
    await enqueue({
      entity: 'feedLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now(), flockId: other, amountGrams: 2_000 },
    });

    const screen = await mount(<Timeline subject={GROUP} />);

    expect(screen.text()).toContain('12 eggs');
    expect(screen.text()).not.toContain('Fed');
    screen.unmount();
  });

  /**
   * An empty box and a screen that could not read are different facts, and the
   * app says so everywhere else. A farm that has logged nothing against a
   * machine yet should be told that, not shown a gap.
   */
  it('says so in words when nothing has been logged against it', async () => {
    const screen = await mount(<Timeline subject={GROUP} />);

    expect(screen.text()).toContain('Nothing logged against this yet');
    screen.unmount();
  });

  it('takes a record back from here, exactly as What happened does', async () => {
    const egg = await eggsToday(12);

    const screen = await mount(<Timeline subject={GROUP} />);

    await screen.press(`event-${egg}`);
    await screen.press(`event-remove-${egg}`);
    await screen.press(`event-remove-${egg}`);
    screen.unmount();

    // Gone from every reader, because the record is archived rather than the
    // row being hidden.
    expect(await listHistory('metric', { subject: GROUP })).toEqual([]);
  });
});

describe('the screens it appears on', () => {
  it('is on a group, under what can be done to it', async () => {
    await eggsToday(9);

    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);

    expect(screen.text()).toContain('9 eggs');
    screen.unmount();
  });

  /**
   * The readings and the services, which is most of what the roadmap means by
   * the history you hand over with a tractor — and the machine screen was the
   * one place it could not be seen.
   */
  it('is on a machine, with its meter readings on it', async () => {
    await enqueue({
      entity: 'equipment',
      op: 'create',
      targetId: MACHINE,
      payload: { name: 'The tractor' },
    });
    await enqueue({
      entity: 'hourReading',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now() - DAY, equipmentId: MACHINE, hours: 240 },
    });

    const screen = await mount(<MachineScreen {...routeProps({ machineId: MACHINE })} />);

    expect(screen.text()).toContain('240 hours');
    screen.unmount();
  });
});
