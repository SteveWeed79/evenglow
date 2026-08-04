import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { readSite, readSiteOrBlank } from '@steading/core/read/growing';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { MyFarmScreen } from '../../apps/mobile/src/screens/MyFarmScreen';

/**
 * "We need a settings menu that allows the user to select what they intend to
 * farm and therefore what portions of our app they see."
 *
 * The load-bearing promise is the one about data: turning something off hides
 * it and keeps it. Invariant 13 is why this is safe to offer at all, so it is
 * the thing most worth a test.
 */

const SITE = newId();

async function aFarm(enterprises?: string[]): Promise<void> {
  await enqueue({
    entity: 'site',
    op: 'create',
    targetId: SITE,
    payload: { name: 'Hollow Farm', ...(enterprises === undefined ? {} : { enterprises }) },
  });
}

beforeEach(async () => {
  await freshStore();
});

describe('a farm that has never been asked', () => {
  it('runs everything, so nothing disappears from an app already in use', async () => {
    await aFarm();

    const site = await readSite();
    expect(site?.enterprises).toEqual(['stock', 'growing', 'iron']);
  });

  /**
   * The farm on the device that reported this had no site record at all, and
   * the screen was blank — title, and nothing under it, permanently.
   *
   * `readSite` returns null for "no site record yet". `useLive` returns null
   * for "not read yet". Through the hook those are the same value, so the
   * screen showed `Loading` forever. Every test below seeded a site first,
   * which is why ~900 passing tests said nothing.
   *
   * A site record is made by naming your site under Growing. Nothing requires
   * you to go there first, and someone who only keeps animals never would.
   */
  it('opens for a farm that has never named a site', async () => {
    const screen = await mount(<MyFarmScreen />);

    for (const key of ['stock', 'growing', 'iron']) {
      expect(screen.has(`enterprise-${key}`), key).toBe(true);
    }
    screen.unmount();
  });

  /** And answering it works, which means minting the site the farm never had. */
  it('records the answer, making the site record on the way', async () => {
    const screen = await mount(<MyFarmScreen />);

    await screen.press('enterprise-growing');
    await screen.press('enterprise-iron');
    await screen.press('save-my-farm');
    screen.unmount();

    const site = await readSite();
    expect(site?.enterprises).toEqual(['stock']);
    expect(site?.id).not.toBe('');
  });
});

describe('choosing what you run', () => {
  it('offers each part of the farm', async () => {
    await aFarm();
    const screen = await mount(<MyFarmScreen />);

    for (const key of ['stock', 'growing', 'iron']) {
      expect(screen.has(`enterprise-${key}`), key).toBe(true);
    }
    screen.unmount();
  });

  it('stores what was chosen', async () => {
    await aFarm();
    const screen = await mount(<MyFarmScreen />);

    await screen.press('enterprise-growing');
    await screen.press('enterprise-iron');
    await screen.press('save-my-farm');

    expect((await readSite())?.enterprises).toEqual(['stock']);
    screen.unmount();
  });

  it('stores them in a fixed order, whatever order they were tapped', async () => {
    /**
     * Two devices that chose the same three must write the same array, or the
     * mutable-entity conflict rules see a difference that is not one.
     */
    await aFarm(['stock']);
    const screen = await mount(<MyFarmScreen />);

    await screen.press('enterprise-iron');
    await screen.press('enterprise-growing');
    await screen.press('save-my-farm');

    expect((await readSite())?.enterprises).toEqual(['stock', 'growing', 'iron']);
    screen.unmount();
  });

  it('lets a farm say none, and that survives', async () => {
    // A stored empty array is a real answer and must not read back as "never
    // asked" — which is the value that means everything.
    await aFarm();
    const screen = await mount(<MyFarmScreen />);

    for (const key of ['stock', 'growing', 'iron']) await screen.press(`enterprise-${key}`);
    await screen.press('save-my-farm');

    expect((await readSite())?.enterprises).toEqual([]);
    screen.unmount();
  });
});

describe('the promise about data', () => {
  it('says what is behind something before it is hidden', async () => {
    await aFarm();
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: newId(),
      payload: { name: 'The hens', species: 'chicken', count: 6 },
    });

    const screen = await mount(<MyFarmScreen />);
    await screen.press('enterprise-stock');

    // Named before it is hidden, so the choice is an informed one.
    expect(screen.text()).toContain('1 recorded');
    expect(screen.text()).toContain('kept, just hidden');
    screen.unmount();
  });

  it('keeps the records when the part they live in is switched off', async () => {
    await aFarm();
    const groupId = newId();
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: groupId,
      payload: { name: 'The hens', species: 'chicken', count: 6 },
    });

    const screen = await mount(<MyFarmScreen />);
    await screen.press('enterprise-stock');
    await screen.press('save-my-farm');
    screen.unmount();

    // Invariant 13. Hiding is not deleting, and this is the assertion that
    // makes the sentence on the screen true.
    const { listGroups } = await import('@steading/core/read/groups');
    expect((await listGroups()).map((g) => g.id)).toContain(groupId);
  });
});

/**
 * How the farm reads, as against what it runs.
 *
 * `units` had been on the site record since the site record existed and no
 * screen wrote it — a setting that could be read and never chosen, which is
 * the same as no setting at all. Six screens now honour it and one has to set
 * it, so this is where it lives: farm-wide, synced, beside the other answers
 * that are preferences rather than facts about a place.
 */
describe('how the farm reads', () => {
  it('remembers metric', async () => {
    const screen = await mount(<MyFarmScreen />);
    await screen.pressLabel('Kilos and °C');
    await screen.press('save-my-farm');

    const site = await readSiteOrBlank();
    expect(site.units).toBe('metric');
  });

  it('remembers a currency', async () => {
    const screen = await mount(<MyFarmScreen />);
    await screen.pressLabel('GBP');
    await screen.press('save-my-farm');

    const site = await readSiteOrBlank();
    expect(site.currency).toBe('GBP');
  });

  /**
   * A farm that never opened Settings is imperial in dollars. Saving this
   * screen for the enterprises must record what it was SHOWING rather than
   * leaving the pair unsaid — the person just looked at them and agreed.
   */
  it('writes what it was showing even when nobody touched them', async () => {
    const screen = await mount(<MyFarmScreen />);
    await screen.press('save-my-farm');

    const site = await readSiteOrBlank();
    expect(site.units).toBe('imperial');
    expect(site.currency).toBe('USD');
  });

  it('shows a price the way the chosen currency reads', async () => {
    const screen = await mount(<MyFarmScreen />);
    await screen.pressLabel('EUR');
    expect(screen.text()).toContain('€22.50');
  });
});
