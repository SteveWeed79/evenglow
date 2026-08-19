import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { seedWindow } from '../support/native/react-native';
import { seedInsets, seedSecureStore } from '../support/native/modules';
import { navCalls } from '../support/native/navigation';
import { StockScreen } from '../../apps/mobile/src/screens/StockScreen';
import { IronScreen } from '../../apps/mobile/src/screens/IronScreen';

/**
 * A list beside the thing it opens.
 *
 * Stock and Iron follow History: the detail arrives in a supporting pane
 * instead of over the top, and the pushed route is untouched so a phone
 * navigates exactly as it always did.
 *
 * ## The property worth testing is that there is only one detail
 *
 * `GroupScreen` and `MachineScreen` were split by taking the `<Screen>`
 * wrapper off and exporting the body, not by writing a second view. The
 * failure this guards is the one that refactor exists to prevent: a pane and a
 * pushed screen that drift, so a withdrawal banner or a hour-meter warning is
 * on one and not the other. If both render the same component, they cannot.
 */

const GROUP = newId();
const MACHINE = newId();

/** A 10" tablet in landscape — two panes, with the rail already taken off. */
const TABLET = { width: 1280, height: 800 };

beforeEach(async () => {
  await freshStore();
  seedWindow();
  seedInsets();
  seedSecureStore({
    'homefarm.claims': JSON.stringify({
      userId: 'u1',
      orgId: newId(),
      role: 'owner',
    }),
  });
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'The goats', species: 'goat', count: 4, purposes: ['milk'] },
  });
  await enqueue({
    entity: 'equipment',
    op: 'create',
    targetId: MACHINE,
    payload: { name: 'The tractor', hasHourMeter: true },
  });
});

describe('Stock', () => {
  it('navigates on a phone and does not open a pane', async () => {
    const screen = await mount(<StockScreen />);

    await screen.press(`group-${GROUP}`);
    expect(navCalls()).toContainEqual({
      action: 'navigate',
      route: 'Group',
      params: { groupId: GROUP },
    });
    screen.unmount();
  });

  it('opens the group beside the list on a tablet, without navigating', async () => {
    seedWindow(TABLET);
    const screen = await mount(<StockScreen />);

    // The first group selects itself, so the pane is never empty — the hub's
    // own content is on screen before anything is tapped.
    expect(screen.text()).toContain('The goats');

    await screen.press(`group-${GROUP}`);
    // Selecting is not navigating. A pushed group over a list that is still
    // visible beside it would be the same screen twice.
    expect(navCalls().map((c) => c.route)).not.toContain('Group');
    screen.unmount();
  });

  /**
   * The pane is the group hub, not a summary of it.
   *
   * `GroupBody` is the whole detail, so its rows — the ones that lead to a
   * treatment, a weighing, a feed — have to be reachable from the pane. A
   * "detail" that dropped them would be a second, worse group screen, which is
   * exactly what taking the wrapper off was meant to avoid.
   */
  it('puts the real hub in the pane, rows and all', async () => {
    seedWindow(TABLET);
    const tablet = await mount(<StockScreen />);
    const beside = tablet.text();
    tablet.unmount();

    // Rows from deep inside `GroupBody`, not from the card that selected it:
    // the pane is the hub, so the acts a morning is made of are all in it.
    for (const row of ['Log a feed', 'Record a treatment', 'What they have had']) {
      expect(beside, row).toContain(row);
    }
  });
});

describe('Iron', () => {
  it('navigates on a phone and does not open a pane', async () => {
    const screen = await mount(<IronScreen />);

    await screen.press(`machine-${MACHINE}`);
    expect(navCalls()).toContainEqual({
      action: 'navigate',
      route: 'Machine',
      params: { machineId: MACHINE },
    });
    screen.unmount();
  });

  it('opens the machine beside the list on a tablet', async () => {
    seedWindow(TABLET);
    const screen = await mount(<IronScreen />);

    expect(screen.text()).toContain('The tractor');

    await screen.press(`machine-${MACHINE}`);
    expect(navCalls().map((c) => c.route)).not.toContain('Machine');

    // The meter panel is part of `MachineBody`, so its presence is the proof
    // that the pane is the detail rather than a repeat of the card.
    expect(screen.text()).toContain('hours');
    screen.unmount();
  });
});
