import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { enqueue } from '@steading/core/sync/queue';
import { localStore } from '@steading/core/db/store';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { PlantingScreen } from '../../apps/mobile/src/screens/PlantingScreen';

/**
 * Pressing a second button on a screen that does not go anywhere.
 *
 * ## One write per screen, silently
 *
 * `useSaver` set `saving` true before running and cleared it **only in the
 * catch**. A save that succeeded left the flag up forever, and the guard at the
 * top of `save` — `if (saving) return` — then refused every later press with no
 * failure, no message and no haptic. The screen simply stopped working.
 *
 * It hid because most forms save and leave. `useSaver(useLeave())` unmounts the
 * screen, the flag goes with it, and nothing is ever asked again — so every
 * add-something form in the app was unaffected and the suite was written
 * against those.
 *
 * The screens that stay put are the ones that show it, and a bed is the obvious
 * case: reported as *"the plant screen only allows for 1 interaction, if you
 * select sow you have to leave the screen to select plant it"*. Sowing and
 * planting out are two presses on one visit by design — `PlantingScreen`'s own
 * header says the buttons are how growing dues clear.
 *
 * Five screens use the stay-put form: this one, Notes, Members, History and
 * Incubation. All five took one press.
 */

const SITE = newId();
const BED = newId();
const VARIETY = newId();
const PLANTING = newId();

async function aPlanting(): Promise<void> {
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
  await enqueue({
    entity: 'variety',
    op: 'create',
    targetId: VARIETY,
    payload: { name: 'Black Pumpkin', crop: 'Pumpkin', family: 'cucurbit', lifecycle: 'annual' },
  });
  await enqueue({
    entity: 'planting',
    op: 'create',
    targetId: PLANTING,
    payload: {
      bedId: BED,
      varietyId: VARIETY,
      season: new Date().getFullYear(),
      status: 'planned',
      // So "Planted it out" is offered too — the button is gated on a variety
      // actually having a transplant stage.
      plannedTransplantAt: Date.now(),
    },
  });
}

beforeEach(async () => {
  await freshStore();
});

describe('a screen that stays where it is after saving', () => {
  it('takes a second press', async () => {
    await aPlanting();
    const screen = await mount(<PlantingScreen {...routeProps({ plantingId: PLANTING })} />);

    const before = (await localStore().counts()).total;

    await screen.press('mark-sown');
    const afterFirst = (await localStore().counts()).total;
    expect(afterFirst, 'the first press wrote nothing').toBeGreaterThan(before);

    // The reported failure: everything after this was ignored.
    await screen.press('mark-harvesting');
    const afterSecond = (await localStore().counts()).total;

    expect(afterSecond, 'the second press on one visit did nothing').toBeGreaterThan(afterFirst);

    screen.unmount();
  });

  /**
   * The whole visit, which is what was actually reported: sow it, plant it out,
   * say it is ready — three stages, one screen, without walking away twice.
   */
  it('takes a whole visit rather than one press of it', async () => {
    await aPlanting();
    const screen = await mount(<PlantingScreen {...routeProps({ plantingId: PLANTING })} />);

    const before = (await localStore().counts()).total;
    await screen.press('mark-sown');
    await screen.press('mark-planted');
    await screen.press('mark-harvesting');

    expect((await localStore().counts()).total - before).toBeGreaterThanOrEqual(3);

    screen.unmount();
  });
});
