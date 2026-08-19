import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { listMachines } from '@homefarm/core/read/iron';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { navCalls } from '../support/native/navigation';
import { AddMachineScreen } from '../../apps/mobile/src/screens/AddMachineScreen';
import { FarmScreen } from '../../apps/mobile/src/screens/FarmScreen';

/**
 * Two things a farm found by using the app.
 *
 * *"Why is The Shelf only available when the app is tracking equipment? Feed
 * is not equipment, it's tied to stock."*
 *
 * *"If I add a tractor it should ask for hours during setup. Most if not all
 * tractors already have hours on them."*
 */

/** A farm that keeps chickens and owns nothing with an engine in it. */
async function poultryOnly(): Promise<void> {
  await enqueue({
    entity: 'site',
    op: 'create',
    targetId: newId(),
    payload: { name: 'The farm', enterprises: ['stock'] },
  });
}

beforeEach(async () => {
  await freshStore();
});

describe('reaching the shelf', () => {
  /**
   * The defect in one assertion. The shelf was reachable from the Iron hub and
   * nowhere else, and Iron is hidden for a farm that runs no equipment — so
   * feed, bedding and medicine were behind a door that farm could not open.
   */
  it('is possible on a farm that owns no machinery', async () => {
    await poultryOnly();

    const farm = await mount(<FarmScreen />);

    // The premise: no Iron row for this farm.
    expect(farm.has('farm-iron')).toBe(false);
    // And the shelf is there anyway.
    expect(farm.has('farm-shelf')).toBe(true);

    await farm.press('farm-shelf');
    expect(navCalls().at(-1)).toMatchObject({ action: 'navigate', route: 'Inventory' });
    farm.unmount();
  });

  it('is offered whatever the farm runs', async () => {
    await enqueue({
      entity: 'site',
      op: 'create',
      targetId: newId(),
      payload: { name: 'The farm', enterprises: ['growing'] },
    });

    const farm = await mount(<FarmScreen />);
    expect(farm.has('farm-shelf')).toBe(true);
    farm.unmount();
  });
});

describe('adding a machine that has already been used', () => {
  /**
   * Almost no tractor arrives at zero. The screen recorded only that a meter
   * exists, so the first service projection had no baseline until somebody
   * separately found Log hours — and nothing said why the app was silent.
   */
  it('records the meter reading alongside the machine', async () => {
    const screen = await mount(<AddMachineScreen />);

    await screen.type('machine-name', 'The tractor');
    await screen.type('machine-hours', '2400');
    await screen.press('save-machine');
    screen.unmount();

    const [machine] = await listMachines();
    expect(machine?.name).toBe('The tractor');
    expect(machine?.hours).toBe(2400);
  });

  /** One decimal place is what an hour meter actually shows. */
  it('keeps the decimal the meter shows', async () => {
    const screen = await mount(<AddMachineScreen />);

    await screen.type('machine-name', 'The mower');
    await screen.type('machine-hours', '184.6');
    await screen.press('save-machine');
    screen.unmount();

    expect((await listMachines())[0]?.hours).toBe(184.6);
  });

  /**
   * Somebody adding a machine from the kitchen table cannot see the meter from
   * there. Blank writes no reading, which is what happened before this field
   * existed.
   */
  it('writes no reading when the figure is left blank', async () => {
    const screen = await mount(<AddMachineScreen />);

    await screen.type('machine-name', 'The tractor');
    await screen.press('save-machine');
    screen.unmount();

    const [machine] = await listMachines();
    expect(machine?.name).toBe('The tractor');
    expect(machine?.hours).toBeNull();
  });

  /** Zero is a real reading on a genuinely new machine, not an empty box. */
  it('records a zero somebody actually typed', async () => {
    const screen = await mount(<AddMachineScreen />);

    await screen.type('machine-name', 'The new mower');
    await screen.type('machine-hours', '0');
    await screen.press('save-machine');
    screen.unmount();

    expect((await listMachines())[0]?.hours).toBe(0);
  });

  /**
   * A pump has no meter, and its services run off dates. Asking for a reading
   * would invite one that nothing could ever use.
   */
  it('does not ask a machine with no meter', async () => {
    const screen = await mount(<AddMachineScreen />);

    expect(screen.has('machine-hours')).toBe(true);
    await screen.pressLabel('It has an hour meter');
    expect(screen.has('machine-hours')).toBe(false);
    screen.unmount();
  });
});
