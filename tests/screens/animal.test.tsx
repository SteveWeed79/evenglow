import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { AnimalScreen } from '../../apps/mobile/src/screens/AnimalScreen';
import { AnimalsScreen } from '../../apps/mobile/src/screens/AnimalsScreen';

/**
 * A named animal, opened.
 *
 * She could be created and listed and never read back. The list showed a name,
 * a tag and the last weight; the weights themselves, the worming, the
 * treatments and the matings were all recorded against her id with nowhere to
 * see any of it — which for a doe with four kiddings behind her is the whole
 * record missing. A mating names a dam, so individuals exist in this app
 * because of exactly this animal, and hers was the record that could not be
 * looked at.
 */

const GROUP = newId();
const ANIMAL = newId();
const DAY = 86_400_000;

async function aDoe(over: Record<string, unknown> = {}): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'The goats', species: 'goat', count: 4 },
  });
  await enqueue({
    entity: 'animal',
    op: 'create',
    targetId: ANIMAL,
    payload: {
      flockId: GROUP,
      name: 'Bramble',
      species: 'goat',
      sex: 'female',
      tag: 'UK7',
      bornAt: new Date('2023-03-02').getTime(),
      ...over,
    },
  });
}

beforeEach(async () => {
  await freshStore();
});

describe('who she is', () => {
  it('leads with what tells her apart from the others in the pen', async () => {
    await aDoe({ breed: 'Saanen' });

    const screen = await mount(<AnimalScreen {...routeProps({ animalId: ANIMAL })} />);

    const identity = screen.text();
    expect(identity).toContain('Saanen');
    expect(identity).toContain('female');
    expect(identity).toContain('tag UK7');
    expect(identity).toContain('born 2023');
    screen.unmount();
  });

  /**
   * Absent is not "unknown" printed in a box. A blank field is noise on a
   * screen read at arm's length, and the species word is what is left when a
   * farm never said the breed.
   */
  it('says the species when no breed was given, and omits what was never said', async () => {
    await aDoe();

    const screen = await mount(<AnimalScreen {...routeProps({ animalId: ANIMAL })} />);

    expect(screen.text()).toContain('goat');
    expect(screen.text()).not.toContain('undefined');
    screen.unmount();
  });

  it('says so plainly when the animal is not there', async () => {
    const screen = await mount(<AnimalScreen {...routeProps({ animalId: newId() })} />);

    expect(screen.text()).toContain('That animal');
    screen.unmount();
  });
});

describe('what she weighs', () => {
  it('shows the last weight and when it was taken', async () => {
    await aDoe();
    await enqueue({
      entity: 'weight',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now() - DAY, animalId: ANIMAL, massUg: 54_000_000_000 },
    });

    const screen = await mount(<AnimalScreen {...routeProps({ animalId: ANIMAL })} />);

    expect(screen.has('animal-weight')).toBe(true);
    // 54 kg, read in the farm's own units — the store's default here is
    // imperial, which is exactly why the assertion is on the reading rather
    // than on a number somebody typed in kilos.
    expect(screen.text()).toContain('119 lb');
    expect(screen.text()).toContain('Last weighed');
    screen.unmount();
  });

  /** An invitation rather than an empty box — UX-SPEC §6. */
  it('invites a first weight rather than showing a gap', async () => {
    await aDoe();

    const screen = await mount(<AnimalScreen {...routeProps({ animalId: ANIMAL })} />);

    expect(screen.text()).toContain('Nothing weighed yet');
    expect(screen.has('animal-weight')).toBe(false);
    screen.unmount();
  });
});

describe('what happened to her', () => {
  it('shows what was recorded against her, and nothing recorded against the group', async () => {
    await aDoe();
    await enqueue({
      entity: 'careLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now(), kind: 'worming', animalId: ANIMAL },
    });
    await enqueue({
      entity: 'feedLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now(), flockId: GROUP, amountGrams: 3_000 },
    });

    const screen = await mount(<AnimalScreen {...routeProps({ animalId: ANIMAL })} />);

    expect(screen.text()).toContain('Wormed');
    // The feed was the group's, and a subject is what a record names.
    expect(screen.text()).not.toContain('Fed');
    screen.unmount();
  });

  it('offers the way back to the group she is one of', async () => {
    await aDoe();

    const screen = await mount(<AnimalScreen {...routeProps({ animalId: ANIMAL })} />);

    expect(screen.has('go-group')).toBe(true);
    expect(screen.text()).toContain('The goats');
    screen.unmount();
  });
});

describe('her matings', () => {
  it('names them by date rather than counting them', async () => {
    await aDoe();
    await enqueue({
      entity: 'breeding',
      op: 'create',
      targetId: newId(),
      payload: {
        species: 'goat',
        damId: ANIMAL,
        bredAt: new Date('2026-02-11').getTime(),
        method: 'natural',
      },
    });

    const screen = await mount(<AnimalScreen {...routeProps({ animalId: ANIMAL })} />);

    expect(screen.text()).toContain('Bred once');
    expect(screen.text()).toContain('February');
    screen.unmount();
  });

  /**
   * A `breeding` names a dam, so a sire has no matings of his own and an empty
   * panel would tell him he has never been used.
   */
  it('shows no panel at all for an animal that has never been bred', async () => {
    await aDoe();

    const screen = await mount(<AnimalScreen {...routeProps({ animalId: ANIMAL })} />);

    expect(screen.text()).not.toContain('Bred');
    screen.unmount();
  });
});

describe('getting to her', () => {
  it('opens from the list, which used to be the end of the road', async () => {
    await aDoe();

    const screen = await mount(<AnimalsScreen {...routeProps({ groupId: GROUP })} />);

    expect(screen.has(`animal-${ANIMAL}`)).toBe(true);
    screen.unmount();
  });
});
