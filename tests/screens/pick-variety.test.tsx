import { beforeEach, describe, expect, it } from 'vitest';
import {
  type FrostDates,
  LIBRARY_VARIETIES,
  newId,
  nextWindow,
  timingOf,
} from '@steading/contracts';
import { listPlantings, listVarieties } from '@steading/core/read/growing';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { PickVarietyScreen } from '../../apps/mobile/src/screens/PickVarietyScreen';

/**
 * Choosing something to plant, two decisions rather than one long list.
 *
 * Grouping put the crop above its varieties and left every one of them on
 * screen, so the list was still the whole library with headings in it.
 * Reported as wanting the crop to collapse and the variety hidden — *"collapse
 * parsley and hide Italian flat leaf"* — which is how the decision is actually
 * made: you know you are planting parsley before you know which parsley.
 *
 * **Searching overrides it**, and that is the part worth asserting. Somebody
 * who typed "flat leaf" has named a variety rather than a crop, and answering
 * that with a closed row saying Parsley would be the app pretending not to have
 * heard.
 */

const SITE = newId();
const BED = newId();

async function aBed(): Promise<void> {
  await enqueue({
    entity: 'site',
    op: 'create',
    targetId: SITE,
    payload: {
      name: 'The farm',
      zone: { system: 'usda', value: '7a' },
      frost: { lastSpring: 415, firstAutumn: 1020, source: 'entered' },
    },
  });
  await enqueue({
    entity: 'bed',
    op: 'create',
    targetId: BED,
    payload: { siteId: SITE, name: 'The top bed', covered: false },
  });
}

beforeEach(async () => {
  await freshStore();
  await aBed();
});

describe('the list before anything is typed', () => {
  it('offers crops rather than every variety at once', async () => {
    const screen = await mount(<PickVarietyScreen {...routeProps({ bedId: BED })} />);

    expect(screen.has('crop-Tomato')).toBe(true);
    // The varieties under it are the second decision, not the first.
    expect(screen.text()).not.toContain('Sungold');

    screen.unmount();
  });

  it('opens one when it is tapped', async () => {
    const screen = await mount(<PickVarietyScreen {...routeProps({ bedId: BED })} />);

    await screen.press('crop-Tomato');

    expect(screen.text()).toContain('Sungold');

    screen.unmount();
  });

  /** One at a time, or opening three leaves the list as long as it was. */
  it('closes the last one when another is opened', async () => {
    const screen = await mount(<PickVarietyScreen {...routeProps({ bedId: BED })} />);

    await screen.press('crop-Tomato');
    expect(screen.text()).toContain('Sungold');

    await screen.press('crop-Pumpkin');
    expect(screen.text()).not.toContain('Sungold');

    screen.unmount();
  });

  it('closes it again on a second tap', async () => {
    const screen = await mount(<PickVarietyScreen {...routeProps({ bedId: BED })} />);

    await screen.press('crop-Tomato');
    await screen.press('crop-Tomato');

    expect(screen.text()).not.toContain('Sungold');

    screen.unmount();
  });
});

describe('searching', () => {
  /**
   * The case the collapse must not break: a variety name typed in full, with
   * nothing to tap because the crop it belongs to is not what was searched for.
   */
  it('shows varieties without anything having to be opened', async () => {
    const screen = await mount(<PickVarietyScreen {...routeProps({ bedId: BED })} />);

    await screen.type('variety-search', 'Sungold');

    expect(screen.text()).toContain('Sungold');

    screen.unmount();
  });

  it('still offers to add one of your own with what was typed', async () => {
    const screen = await mount(<PickVarietyScreen {...routeProps({ bedId: BED })} />);

    await screen.type('variety-search', 'Black Futsu');

    expect(screen.has('add-variety')).toBe(true);
    expect(screen.text()).toContain('Black Futsu');

    screen.unmount();
  });

  /**
   * The library cannot answer this one, and until now nothing could.
   *
   * A variety somebody added themselves was reachable exactly once — on the
   * screen that created it. Searching for it afterwards matched nothing,
   * because the search only ever looked at `LIBRARY_VARIETIES`, so the only
   * way to plant Black Futsu a second time was to add a second Black Futsu.
   */
  it('finds a variety the farm added itself', async () => {
    await enqueue({
      entity: 'variety',
      op: 'create',
      targetId: newId(),
      payload: {
        name: 'Black Futsu',
        crop: 'Pumpkin',
        family: 'cucurbit',
        lifecycle: 'annual',
        daysToMaturity: 100,
        custom: true,
      },
    });

    const screen = await mount(<PickVarietyScreen {...routeProps({ bedId: BED })} />);
    await screen.type('variety-search', 'Black Futsu');

    expect(screen.has('mine-Black Futsu')).toBe(true);

    screen.unmount();
  });
});

/**
 * What this farm already grows, at the top where it is one tap away.
 *
 * A farm plants roughly the same fifteen things every year. Making it scroll
 * an alphabet of a hundred and ninety-three crops to reach one of them — every
 * season, for the rest of the farm's life — is the report this answers.
 */
describe('the varieties the farm already has', () => {
  it('is not offered on an empty farm', async () => {
    const screen = await mount(<PickVarietyScreen {...routeProps({ bedId: BED })} />);

    expect(screen.text()).not.toContain('You already grow');

    screen.unmount();
  });

  /**
   * **The defect this closes.** Every planting used to copy the library entry
   * into a fresh record, so a farm that put Sungold in three beds ended up with
   * three Sungolds. Editing the days to maturity on one of them then left the
   * other two contradicting it on the next screen that read them.
   */
  it('plants one it already holds without minting a second record', async () => {
    const first = await mount(<PickVarietyScreen {...routeProps({ bedId: BED })} />);
    await first.press('crop-Tomato');
    await first.pressLabel('Sungold');
    await first.press('plant-it');
    first.unmount();

    expect(await listVarieties()).toHaveLength(1);

    const again = await mount(<PickVarietyScreen {...routeProps({ bedId: BED })} />);
    expect(again.text()).toContain('You already grow');
    await again.press('mine-Sungold');
    await again.press('plant-it');
    again.unmount();

    const varieties = await listVarieties();
    const plantings = await listPlantings();

    expect(varieties).toHaveLength(1);
    expect(plantings).toHaveLength(2);
    // Both beds point at the same Sungold, which is the whole point.
    expect(plantings[0]?.varietyId).toBe(plantings[1]?.varietyId);
  });
});

/**
 * The seasonal shortcut.
 *
 * Frost dates arranged so today IS the last spring frost, because the point
 * being asserted is that the screen reads the window engine at all — the
 * arithmetic itself is covered in `unit/planting-window.test.ts`. A screen
 * wired at one end only is the recurring failure in this codebase, so what is
 * checked here is the wiring.
 */
describe('what can go in now', () => {
  const now = new Date();
  const FROST: FrostDates = {
    lastSpring: (now.getUTCMonth() + 1) * 100 + now.getUTCDate(),
    firstAutumn: 1231,
    source: 'entered',
  };

  const nearToday = (): string[] => {
    const crops = new Set<string>();
    for (const variety of LIBRARY_VARIETIES) {
      if (nextWindow(timingOf(variety), FROST, now.getFullYear(), Date.now()) !== null) {
        crops.add(variety.crop);
      }
    }
    return [...crops];
  };

  beforeEach(async () => {
    await freshStore();
    await enqueue({
      entity: 'site',
      op: 'create',
      targetId: SITE,
      payload: {
        name: 'The farm',
        zone: { system: 'usda', value: '7a' },
        frost: FROST,
      },
    });
    await enqueue({
      entity: 'bed',
      op: 'create',
      targetId: BED,
      payload: { siteId: SITE, name: 'The top bed', covered: false },
    });
  });

  it('leads with the crops whose moment is now', async () => {
    const crops = nearToday();
    expect(crops.length).toBeGreaterThan(0);

    const screen = await mount(<PickVarietyScreen {...routeProps({ bedId: BED })} />);

    expect(screen.text()).toContain('Ready to go in now');
    expect(screen.has(`now-${crops[0]}`)).toBe(true);

    screen.unmount();
  });

  /**
   * A shortcut that hid the road would be a worse screen than the one being
   * fixed. Invariant 13, and the same rule as every other warning here: the
   * window is a rule of thumb, and a grower with a tunnel beats it.
   */
  it('hides nothing — every crop is still in the full list', async () => {
    const crops = nearToday();
    const screen = await mount(<PickVarietyScreen {...routeProps({ bedId: BED })} />);

    for (const crop of crops) expect(screen.has(`crop-${crop}`)).toBe(true);
    expect(screen.has('crop-Tomato')).toBe(true);

    screen.unmount();
  });

  /** A search is a direct question; the full list answers it on its own. */
  it('stands down while something is being typed', async () => {
    const screen = await mount(<PickVarietyScreen {...routeProps({ bedId: BED })} />);

    await screen.type('variety-search', 'Sungold');

    expect(screen.text()).not.toContain('Ready to go in now');
    expect(screen.text()).toContain('Sungold');

    screen.unmount();
  });
});
