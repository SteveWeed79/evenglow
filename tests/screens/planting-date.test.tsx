import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { listPlantings } from '@steading/core/read/growing';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { PlantingScreen } from '../../apps/mobile/src/screens/PlantingScreen';

/**
 * The day it happened, not the day it was typed.
 *
 * The stage buttons stamped `Date.now()`, which quietly asserted that nobody
 * ever records anything in the evening about a morning, or on Sunday about
 * Friday. On an app whose premise is that a phone comes out of a pocket when it
 * can, that is the wrong assumption.
 *
 * It is also not cosmetic. `sownAt` is the anchor harvest is counted from —
 * `anchor = transplantedAt ?? sownAt` — so a pumpkin recorded four days late is
 * a pumpkin the app expects four days early for the rest of the season. The
 * previous report in this area was the same arithmetic from the other end:
 * *"i told the app i put a pumpkin crop 'in the ground' today and its telling
 * me it should have been harvested 15 days ago."*
 *
 * The default has to stay one press, which is what the first test is for.
 */

const SITE = newId();
const BED = newId();
const VARIETY = newId();
const PLANTING = newId();

/** Local midnight, the resolution every date in this app is kept at. */
function startOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** A day this month that is definitely not today, so a test cannot pass by luck. */
const OTHER_DAY = new Date().getDate() === 5 ? 6 : 5;

function dayThisMonth(day: number): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), day).getTime();
}

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
    payload: { name: 'Black Futsu', crop: 'Pumpkin', family: 'cucurbit', lifecycle: 'annual' },
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
      // So "Planted it out" is offered as well — the button is gated on the
      // variety actually having a transplant stage.
      plannedTransplantAt: Date.now(),
    },
  });
}

async function sownAt(): Promise<number | undefined> {
  return (await listPlantings()).find((p) => p.id === PLANTING)?.sownAt;
}

beforeEach(async () => {
  await freshStore();
  await aPlanting();
});

describe('recording a stage', () => {
  /**
   * The case that must not get worse. Somebody sowing something and reaching
   * for their phone in the same minute should still press one button, and the
   * date they never touched should be today.
   */
  it('still takes one press, and records today', async () => {
    const screen = await mount(<PlantingScreen {...routeProps({ plantingId: PLANTING })} />);

    await screen.press('mark-sown');

    expect(await sownAt()).toBe(startOfToday());

    screen.unmount();
  });

  it('says which day the press will record before it is pressed', async () => {
    const screen = await mount(<PlantingScreen {...routeProps({ plantingId: PLANTING })} />);

    expect(screen.text()).toContain('Recording for');
    expect(screen.has('planting-when')).toBe(true);

    screen.unmount();
  });

  /** The picker stays shut until it is asked for — twelve month chips standing
      between the heading and "Sowed it" would cost the one-press case. */
  it('keeps the day picker out of the way until it is wanted', async () => {
    const screen = await mount(<PlantingScreen {...routeProps({ plantingId: PLANTING })} />);

    expect(screen.has('day-of-month')).toBe(false);

    await screen.press('planting-when');

    expect(screen.has('day-of-month')).toBe(true);

    screen.unmount();
  });
});

describe('recording something that happened earlier', () => {
  it('sows on the day that was picked rather than the day it was typed', async () => {
    const screen = await mount(<PlantingScreen {...routeProps({ plantingId: PLANTING })} />);

    await screen.press('planting-when');
    await screen.type('day-of-month', String(OTHER_DAY));
    await screen.press('mark-sown');

    expect(await sownAt()).toBe(dayThisMonth(OTHER_DAY));

    screen.unmount();
  });

  /**
   * The date is one choice for the visit, not one per button. Sowing and
   * planting out on the same visit is the reported workflow — *"the plant
   * screen only allows for 1 interaction"* — and re-picking the day between
   * two presses of the same trip would be the app forgetting what it was told.
   */
  it('keeps the picked day across a second press on the same visit', async () => {
    const screen = await mount(<PlantingScreen {...routeProps({ plantingId: PLANTING })} />);

    await screen.press('planting-when');
    await screen.type('day-of-month', String(OTHER_DAY));
    await screen.press('mark-sown');
    await screen.press('mark-planted');

    const planting = (await listPlantings()).find((p) => p.id === PLANTING);

    expect(planting?.sownAt).toBe(dayThisMonth(OTHER_DAY));
    expect(planting?.transplantedAt).toBe(dayThisMonth(OTHER_DAY));

    screen.unmount();
  });
});
