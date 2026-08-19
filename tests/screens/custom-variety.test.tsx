import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { enqueue } from '@homefarm/core/sync/queue';
import { localStore } from '@homefarm/core/db/store';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { AddVarietyScreen } from '../../apps/mobile/src/screens/AddVarietyScreen';

/**
 * Planting something the library has never heard of.
 *
 * The bundled library is about sixty varieties and there are thousands. The
 * first real morning of use found one — *"my wife just planted Black
 * Pumpkins"* — a search with no result and no way forward, over a seed already
 * in the ground.
 *
 * `DOMAIN-SCOPE.md` 2.4 settles what happens then: *"an app that tells a grower
 * no is an app that is wrong about that grower."* A picker offering only what
 * shipped is that refusal wearing a different hat, and a library will always
 * lose this race.
 *
 * **The data model was already waiting.** `variety.custom` has been in the
 * schema since it was written, documented as *"true for anything the farm added
 * itself"*, and `varietyPayload` has always stamped it false. Nothing anywhere
 * set it true — the flag was waiting for a screen.
 */

const SITE = newId();
const BED = newId();

async function aBed(): Promise<void> {
  await enqueue({
    entity: 'site',
    op: 'create',
    targetId: SITE,
    payload: { name: 'The farm', zone: { system: 'usda', value: '7a' } },
  });
  await enqueue({
    entity: 'bed',
    op: 'create',
    targetId: BED,
    payload: { siteId: SITE, name: 'The top bed', covered: false },
  });
}

async function varieties(): Promise<Record<string, unknown>[]> {
  const records = await localStore().readRecordsByEntity('variety');
  return records.filter((r) => !r.deleted).map((r) => r.value as Record<string, unknown>);
}

beforeEach(async () => {
  await freshStore();
});

describe('a variety the farm adds itself', () => {
  it('is recorded, and marked as the farm’s own', async () => {
    await aBed();
    const screen = await mount(<AddVarietyScreen {...routeProps({ bedId: BED })} />);

    await screen.type('variety-name', 'Black Futsu');
    await screen.type('variety-crop', 'Pumpkin');
    await screen.press('variety-save');

    const [made] = await varieties();
    expect(made?.['name']).toBe('Black Futsu');
    expect(made?.['crop']).toBe('Pumpkin');
    // The flag that has existed since the schema was written and had nothing
    // to set it.
    expect(made?.['custom']).toBe(true);

    screen.unmount();
  });

  /**
   * The family drives `rotationConflict` and is the one field on this form a
   * grower has no reason to know — nobody planting a pumpkin thinks
   * "cucurbit". The library already maps crops to families, so a farm adding
   * another pumpkin gets the right answer without being asked.
   */
  it('works the family out from the crop', async () => {
    await aBed();
    const screen = await mount(<AddVarietyScreen {...routeProps({ bedId: BED })} />);

    await screen.type('variety-name', 'Black Futsu');
    await screen.type('variety-crop', 'Pumpkin');
    await screen.press('variety-save');

    expect((await varieties())[0]?.['family']).toBe('cucurbit');

    screen.unmount();
  });

  /** An unrecognised crop means no rotation warning rather than a wrong one. */
  it('falls back to other for a crop it does not know', async () => {
    await aBed();
    const screen = await mount(<AddVarietyScreen {...routeProps({ bedId: BED })} />);

    await screen.type('variety-name', 'Something');
    await screen.type('variety-crop', 'Salsify de Provence');
    await screen.press('variety-save');

    expect((await varieties())[0]?.['family']).toBe('other');

    screen.unmount();
  });

  /**
   * Two fields, because the alternative is a form somebody abandons while
   * holding a seed packet. No days to maturity simply means no harvest row.
   */
  it('needs only a name and a crop', async () => {
    await aBed();
    const screen = await mount(<AddVarietyScreen {...routeProps({ bedId: BED })} />);

    await screen.type('variety-name', 'Black Futsu');
    await screen.type('variety-crop', 'Pumpkin');
    await screen.press('variety-save');

    const [made] = await varieties();
    expect(made?.['daysToMaturity']).toBeUndefined();

    screen.unmount();
  });

  it('refuses to save without both of them', async () => {
    await aBed();
    const screen = await mount(<AddVarietyScreen {...routeProps({ bedId: BED })} />);

    await screen.type('variety-name', 'Black Futsu');
    await screen.press('variety-save');

    expect(await varieties()).toHaveLength(0);

    screen.unmount();
  });

  /** Adding it is planting it — that is why anybody is on this screen. */
  it('plants it in the bed at the same moment', async () => {
    await aBed();
    const screen = await mount(<AddVarietyScreen {...routeProps({ bedId: BED })} />);

    await screen.type('variety-name', 'Black Futsu');
    await screen.type('variety-crop', 'Pumpkin');
    await screen.press('variety-save');

    const plantings = (await localStore().readRecordsByEntity('planting')).filter((r) => !r.deleted);
    expect(plantings).toHaveLength(1);
    expect((plantings[0]?.value as Record<string, unknown>)['bedId']).toBe(BED);

    screen.unmount();
  });
});
