import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { BreedingScreen } from '../../apps/mobile/src/screens/BreedingScreen';

/**
 * A group's breeding screen shows that group's matings, and no others.
 *
 * It filtered on a name map built from **every animal on the farm**, so the
 * question it asked was "does this dam exist here" rather than "is this dam in
 * this group". A goat's mating appeared on the sheep's screen, under the
 * sheep's name.
 *
 * The line directly above it filtered dams by `flockId` perfectly well, which
 * is what makes this a slip rather than a misunderstanding — and is probably
 * why it read as correct to everyone who looked at it, including the tests,
 * which never put two groups in one farm.
 *
 * That last part is the lesson worth keeping: a tenancy-shaped bug needs two
 * of the thing to be visible, and a fixture with one of everything cannot see
 * any of them.
 */

const GOATS = newId();
const SHEEP = newId();
const NANNY = newId();
const EWE = newId();

async function twoGroupsEachWithADam(): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GOATS,
    payload: { name: 'The goats', species: 'goat', count: 4, purposes: ['milk'] },
  });
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: SHEEP,
    payload: { name: 'The sheep', species: 'sheep', count: 9, purposes: ['fibre'] },
  });
  await enqueue({
    entity: 'animal',
    op: 'create',
    targetId: NANNY,
    payload: { flockId: GOATS, name: 'Bramble', species: 'goat', sex: 'female' },
  });
  await enqueue({
    entity: 'animal',
    op: 'create',
    targetId: EWE,
    payload: { flockId: SHEEP, name: 'Marigold', species: 'sheep', sex: 'female' },
  });
}

async function aMating(damId: string, species: string, at: number): Promise<void> {
  await enqueue({
    entity: 'breeding',
    op: 'create',
    targetId: newId(),
    payload: { species, damId, bredAt: at, method: 'natural' },
  });
}

beforeEach(async () => {
  await freshStore();
  await twoGroupsEachWithADam();
});

describe('two groups on one farm', () => {
  it('shows a group only its own matings', async () => {
    await aMating(NANNY, 'goat', Date.now() - 10 * 86_400_000);
    await aMating(EWE, 'sheep', Date.now() - 3 * 86_400_000);

    const screen = await mount(<BreedingScreen {...routeProps({ groupId: GOATS })} />);

    expect(screen.text()).toContain('Bramble');
    expect(screen.text()).not.toContain('Marigold');

    screen.unmount();
  });

  /**
   * The other direction, because a filter that is merely inverted passes the
   * test above.
   */
  it('shows the other group its own, and not the first one’s', async () => {
    await aMating(NANNY, 'goat', Date.now() - 10 * 86_400_000);
    await aMating(EWE, 'sheep', Date.now() - 3 * 86_400_000);

    const screen = await mount(<BreedingScreen {...routeProps({ groupId: SHEEP })} />);

    expect(screen.text()).toContain('Marigold');
    expect(screen.text()).not.toContain('Bramble');

    screen.unmount();
  });

  it('shows a group nothing when only the other group has bred', async () => {
    await aMating(EWE, 'sheep', Date.now() - 3 * 86_400_000);

    const screen = await mount(<BreedingScreen {...routeProps({ groupId: GOATS })} />);

    expect(screen.text()).not.toContain('Marigold');

    screen.unmount();
  });
});
