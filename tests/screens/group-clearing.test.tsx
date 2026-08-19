import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { enqueue } from '@homefarm/core/sync/queue';
import { localStore } from '@homefarm/core/db/store';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { EditGroupScreen } from '../../apps/mobile/src/screens/EditGroupScreen';

/**
 * Taking something off a group has to actually take it off.
 *
 * An update MERGES on both sides — `{ ...previous, ...payload }` in
 * `db/project.ts`, `$set` in `sync/apply.ts` — so a field left out of an edit
 * payload keeps whatever it had. `EditGroupScreen` left `purposes` out
 * whenever the list was empty, which meant the one thing a person could not do
 * was remove the last purpose: the flock went on being kept for meat, with the
 * grow-out countdown that hangs off that, after being told otherwise.
 *
 * `TreatmentScreen` had already met this class and fixed it there, with a
 * comment explaining it. Nobody swept for the rest.
 *
 * ## The half that used to be missing, and now is not
 *
 * That fix — name every optional field, with `undefined` where it is now
 * absent — was right locally and did not reach the server. `JSON.stringify`
 * drops an `undefined` value, so the mutation arrived without the key and
 * `$set` left the old value standing: the device read cleared, the server read
 * unchanged, and the next snapshot put it back.
 *
 * An empty array never had that problem, which is why `purposes` was fixable
 * first and `breedId`, `bornAt` and `processAtWeeks` were not. They are fixed
 * now: `contracts/clearing.ts` gives the wire a `null` meaning *remove this*,
 * the applier turns it into `$unset`, and the tests below assert both halves —
 * the record on this device, and the instruction that leaves it.
 */

const GROUP = newId();

async function aMeatFlock(): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: {
      name: 'The broilers',
      species: 'chicken',
      count: 20,
      purposes: ['meat', 'eggs'],
    },
  });
}

async function storedGroup(): Promise<Record<string, unknown>> {
  const records = await localStore().readRecordsByEntity('flock');
  const live = records.filter((r) => !r.deleted);
  return live[0]?.value as Record<string, unknown>;
}

beforeEach(async () => {
  await freshStore();
  await aMeatFlock();
});

describe('clearing a purpose', () => {
  it('removes the last purpose instead of silently keeping it', async () => {
    const screen = await mount(<EditGroupScreen {...routeProps({ groupId: GROUP })} />);

    // Both purposes off, which is the state the old payload could not express.
    await screen.pressLabel('Meat');
    await screen.pressLabel('Eggs');
    await screen.press('save-group');

    expect((await storedGroup()).purposes).toEqual([]);

    screen.unmount();
  });

  it('still sends the remaining ones when only some are taken off', async () => {
    const screen = await mount(<EditGroupScreen {...routeProps({ groupId: GROUP })} />);

    await screen.pressLabel('Meat');
    await screen.press('save-group');

    expect((await storedGroup()).purposes).toEqual(['eggs']);

    screen.unmount();
  });

  /**
   * The empty array has to be a real value on the wire, not an absence.
   *
   * This is the assertion that distinguishes the fix from the bug it replaces:
   * a payload that omits `purposes` and a payload carrying `[]` look identical
   * on this device until something merges them, and only one of them survives
   * `JSON.stringify` as an instruction to the server.
   */
  it('puts the empty list in the payload rather than omitting it', async () => {
    const screen = await mount(<EditGroupScreen {...routeProps({ groupId: GROUP })} />);

    await screen.pressLabel('Meat');
    await screen.pressLabel('Eggs');
    await screen.press('save-group');

    const outbox = await localStore().readOutboxBySeq();
    const update = outbox.find((m) => m.entity === 'flock' && m.op === 'update');
    const payload = update?.payload as Record<string, unknown>;

    expect(payload).toHaveProperty('purposes');
    expect(JSON.parse(JSON.stringify(payload))).toHaveProperty('purposes');

    screen.unmount();
  });
});

describe('taking the breed off', () => {
  /**
   * The field this screen's comment used to say could be set and changed and
   * never removed. Tapping the selected chip is how a farm says "not that one
   * after all", and until the wire had a word for it that tap reached nothing.
   */
  it('removes it from the record on this device', async () => {
    await enqueue({
      entity: 'flock',
      op: 'update',
      targetId: GROUP,
      payload: { breedId: 'chicken-australorp' },
    });

    const screen = await mount(<EditGroupScreen {...routeProps({ groupId: GROUP })} />);
    await screen.pressLabel('Australorp');
    await screen.press('save-group');

    expect(await storedGroup()).not.toHaveProperty('breedId');
    expect((await storedGroup()).name).toBe('The broilers');

    screen.unmount();
  });

  /**
   * And the half that used to be lost: the instruction has to survive
   * `JSON.stringify`, which is exactly what `{ breedId: undefined }` did not.
   */
  it('says so on the wire, as a null the server can act on', async () => {
    await enqueue({
      entity: 'flock',
      op: 'update',
      targetId: GROUP,
      payload: { breedId: 'chicken-australorp' },
    });

    const screen = await mount(<EditGroupScreen {...routeProps({ groupId: GROUP })} />);
    await screen.pressLabel('Australorp');
    await screen.press('save-group');

    const outbox = await localStore().readOutboxBySeq();
    const last = outbox.filter((m) => m.entity === 'flock' && m.op === 'update').pop();
    const onTheWire = JSON.parse(JSON.stringify(last?.payload)) as Record<string, unknown>;

    expect(onTheWire).toHaveProperty('breedId');
    expect(onTheWire.breedId).toBeNull();

    screen.unmount();
  });
});
