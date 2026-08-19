import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { QuickAddScreen } from '../../apps/mobile/src/screens/QuickAddScreen';

/**
 * The tap budget R1 sets, finally met by something other than eggs.
 *
 * Eggs reach the Tally in one tap. A treatment, a job, a feed or a loss cost
 * three before the form opened — Stock, the group, the act — so every non-egg
 * record has been outside its own budget since it was written.
 */

const HENS = newId();
const GOATS = newId();

async function group(id: string, name: string, species: string): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: id,
    payload: { name, species, count: 6, purposes: ['eggs'] },
  });
}

beforeEach(async () => {
  await freshStore();
});

describe('what it offers', () => {
  it('offers the four daily acts and nothing else', async () => {
    await group(HENS, 'The hens', 'chicken');
    const screen = await mount(<QuickAddScreen />);

    for (const act of ['quick-treatment', 'quick-care', 'quick-feed', 'quick-loss']) {
      expect(screen.has(act), act).toBe(true);
    }

    // Weighing, produce and the breeding book are occasional and stay on the
    // group. A quick-add that offers everything is a menu.
    expect(screen.has('quick-weigh')).toBe(false);
    expect(screen.has('quick-produce')).toBe(false);
    screen.unmount();
  });

  it('says so plainly when there is nothing to log against', async () => {
    const screen = await mount(<QuickAddScreen />);

    // Everything here records against a group, so an empty farm gets a
    // sentence rather than four rows that lead nowhere.
    expect(screen.text()).toContain('Add what you keep under Stock');
    expect(screen.has('quick-treatment')).toBe(false);
    screen.unmount();
  });
});

describe('which group', () => {
  it('asks, when there is more than one', async () => {
    await group(HENS, 'The hens', 'chicken');
    await group(GOATS, 'The goats', 'goat');

    const screen = await mount(<QuickAddScreen />);
    await screen.press('quick-feed');

    expect(screen.has(`quick-group-${HENS}`)).toBe(true);
    expect(screen.has(`quick-group-${GOATS}`)).toBe(true);
    // The chosen act is named, so the second question has context.
    expect(screen.text()).toContain('Log a feed');
    screen.unmount();
  });

  it('does not ask when there is only one', async () => {
    await group(HENS, 'The hens', 'chicken');

    const screen = await mount(<QuickAddScreen />);
    await screen.press('quick-care');

    // A smallholding with one flock should not be asked which flock — that is
    // the tap that puts this back outside the budget.
    expect(screen.has(`quick-group-${HENS}`)).toBe(false);
    screen.unmount();
  });
});
