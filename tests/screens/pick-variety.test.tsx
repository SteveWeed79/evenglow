import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
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
});
