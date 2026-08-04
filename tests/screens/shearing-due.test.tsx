import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { TodayScreen } from '../../apps/mobile/src/screens/TodayScreen';

/**
 * The clip reaching a person.
 *
 * The builder and its interval are tested in `tests/unit/fibre.test.ts`. This
 * is the half that has failed in this codebase before and that nothing else
 * catches: a due builder wired to no caller. Seven husbandry rows once sat on
 * Today while the birth, hatch, sow and service builders produced nothing at
 * all, because the hook fed them groups and stopped — every one of them fully
 * tested, and none of them on a screen.
 */

const GROUP = newId();

/** A ULID minted far enough back that the group is past its month of grace. */
const OLD = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

async function ewes(over: Record<string, unknown> = {}, id = GROUP): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: id,
    payload: {
      name: 'The Ewes',
      species: 'sheep',
      count: 20,
      purposes: ['fibre'],
      breedId: 'sheep-merino',
      ...over,
    },
  });
}

beforeEach(async () => {
  await freshStore();
});

describe('a clip owed', () => {
  it('reaches Today', async () => {
    await ewes({}, OLD);

    const screen = await mount(<TodayScreen />);
    expect(screen.text()).toContain('Shearing');
    expect(screen.text()).toContain('The Ewes');
  });

  /**
   * The Katahdin is the case the breed library was careful about — "hair sheep
   * — sheds its coat, so there is no shearing at all". A default interval
   * would put a permanent unclearable row on a farm that will never shear.
   */
  it('never asks a hair sheep', async () => {
    await ewes({ breedId: 'sheep-katahdin', purposes: ['meat', 'fibre'] }, OLD);

    const screen = await mount(<TodayScreen />);
    expect(screen.text()).not.toContain('Shearing');
  });

  /** Recording the clip is what clears it — nothing is ticked (property 3). */
  it('goes away once a clip is recorded', async () => {
    await ewes({}, OLD);
    await enqueue({
      entity: 'shearing',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now(), flockId: OLD, massUg: 2_200_000_000, animalsShorn: 20 },
    });

    const screen = await mount(<TodayScreen />);
    expect(screen.text()).not.toContain('Shearing');
  });

  /**
   * A farm shears the whole paddock in one afternoon and records whichever
   * subject was to hand. A due that only looked at group clips would tell that
   * farm it had never shorn anything.
   */
  it('is cleared by a clip recorded against a named animal', async () => {
    await ewes({}, OLD);
    const animal = newId();
    await enqueue({
      entity: 'animal',
      op: 'create',
      targetId: animal,
      payload: { name: 'Maisie', flockId: OLD, species: 'sheep' },
    });
    await enqueue({
      entity: 'shearing',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now(), animalId: animal, massUg: 2_200_000_000 },
    });

    const screen = await mount(<TodayScreen />);
    expect(screen.text()).not.toContain('Shearing');
  });
});
