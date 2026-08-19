import { beforeEach, describe, expect, it } from 'vitest';
import { gramsToUg, newId, poundsToUg } from '@homefarm/contracts';
import { enqueue } from '@homefarm/core/sync/queue';
import { localStore } from '@homefarm/core/db/store';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { HarvestScreen } from '../../apps/mobile/src/screens/HarvestScreen';

/**
 * A metric farm weighs its harvest in kilos.
 *
 * This screen offered pounds and ounces to everybody and converted with
 * `poundsToUg` regardless of the farm's setting. `WeighScreen` had the right
 * table and the right comment — *"a metric farm being asked for pounds is the
 * setting failing out loud"* — and this screen had never been told.
 *
 * **Entry is the worst place to get this wrong.** A displayed unit that is
 * wrong is read wrong once; a typed one is converted in somebody's head and
 * stored as an integer that nothing downstream can distinguish from a real
 * weighing. A farm entering 2 for two kilos got two pounds, and a season of
 * yield-per-bed is then quietly out by a factor of 2.2.
 *
 * Nothing caught it because no test had ever set a farm to metric — the units
 * work landed screen by screen, and a fixture that is imperial everywhere
 * cannot see an imperial assumption.
 */

const SITE = newId();
const BED = newId();
const VARIETY = newId();
const PLANTING = newId();

async function aFarmIn(units: 'imperial' | 'metric' | undefined): Promise<void> {
  await enqueue({
    entity: 'site',
    op: 'create',
    targetId: SITE,
    // Omitted rather than nulled when absent: that is the state of every farm
    // that predates the setting, which is the case the third test is about.
    payload: { name: 'Hollow Farm', ...(units === undefined ? {} : { units }) },
  });
  await enqueue({
    entity: 'bed',
    op: 'create',
    targetId: BED,
    payload: { siteId: SITE, name: 'The top bed', covered: false },
  });
  await enqueue({
    entity: 'variety',
    op: 'create',
    targetId: VARIETY,
    payload: { name: 'Charlotte', crop: 'potato', family: 'solanaceae', lifecycle: 'annual' },
  });
  await enqueue({
    entity: 'planting',
    op: 'create',
    targetId: PLANTING,
    payload: {
      bedId: BED,
      varietyId: VARIETY,
      season: new Date().getFullYear(),
      status: 'in-ground',
      sownAt: Date.now(),
    },
  });
}

async function harvests(): Promise<Record<string, unknown>[]> {
  const records = await localStore().readRecordsByEntity('harvest');
  return records.filter((r) => !r.deleted).map((r) => r.value as Record<string, unknown>);
}

beforeEach(async () => {
  await freshStore();
});

describe('a metric farm', () => {
  it('is offered kilos, and 2 means two kilos', async () => {
    await aFarmIn('metric');
    const screen = await mount(<HarvestScreen {...routeProps({ plantingId: PLANTING })} />);

    expect(screen.text()).toContain('Kilos');
    expect(screen.text()).not.toContain('Pounds');

    await screen.type('harvest-mass', '2');
    await screen.press('save-harvest');

    const [logged] = await harvests();
    expect(logged?.massUg).toBe(gramsToUg(2000));

    screen.unmount();
  });
});

describe('an imperial farm', () => {
  it('is offered pounds, and keeps reading 2 as two pounds', async () => {
    await aFarmIn('imperial');
    const screen = await mount(<HarvestScreen {...routeProps({ plantingId: PLANTING })} />);

    expect(screen.text()).toContain('Pounds');
    expect(screen.text()).not.toContain('Kilos');

    await screen.type('harvest-mass', '2');
    await screen.press('save-harvest');

    const [logged] = await harvests();
    expect(logged?.massUg).toBe(poundsToUg(2));

    screen.unmount();
  });

  /**
   * Imperial is the default, so a farm that has never answered must not be
   * caught by the change — which is most farms, and every existing one.
   */
  it('is what a farm with no setting gets', async () => {
    await aFarmIn(undefined);

    const screen = await mount(<HarvestScreen {...routeProps({ plantingId: PLANTING })} />);

    expect(screen.text()).toContain('Pounds');

    screen.unmount();
  });
});
