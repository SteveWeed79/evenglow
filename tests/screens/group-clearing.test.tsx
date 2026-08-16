import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { enqueue } from '@steading/core/sync/queue';
import { localStore } from '@steading/core/db/store';
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
 * ## The half that is not fixed here, and why
 *
 * That fix — name every optional field, with `undefined` where it is now
 * absent — is right locally and does not reach the server. `JSON.stringify`
 * drops an `undefined` value, so the mutation arrives without the key and
 * `$set` leaves the old value standing: the device reads cleared, the server
 * reads unchanged, and the next snapshot puts it back.
 *
 * An empty array does not have that problem, which is why `purposes` is
 * fixable today and `breedId`, `bornAt` and `processAtWeeks` are not. Clearing
 * those needs a way to say "clear this" on the wire, which is a contract
 * change. Consistently stale beats silently divergent in the meantime, and the
 * test below pins that choice so it is not mistaken for an oversight twice.
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
