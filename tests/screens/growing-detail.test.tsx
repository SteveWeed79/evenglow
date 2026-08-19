import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { BedScreen } from '../../apps/mobile/src/screens/BedScreen';
import { VarietyScreen } from '../../apps/mobile/src/screens/VarietyScreen';
import { GrowingScreen } from '../../apps/mobile/src/screens/GrowingScreen';

/**
 * A bed and a variety, which are shaped differently from the rest.
 *
 * **Nothing append-only names either of them.** A `harvest` names its
 * *planting*; a planting names the bed and the variety. So a timeline built the
 * way the animal and machine screens build theirs is empty by construction, and
 * a bed that had fed a family all summer would read "nothing logged against
 * this yet".
 *
 * Two consequences, and both are asserted below. What a bed *is* comes from
 * `planting` — a mutable record of state, which is why the history projection
 * excludes it and why these screens read it directly. And the harvests still
 * belong here, so the screen asks for **itself and its plantings** by name:
 * the hop is made where somebody meant it rather than by a hierarchy walk every
 * timeline in the app would inherit.
 */

const SITE = newId();
const BED = newId();
const OTHER_BED = newId();
const VARIETY = newId();
const PLANTING = newId();

const YEAR = new Date().getFullYear();

async function aGarden(): Promise<void> {
  await enqueue({
    entity: 'site',
    op: 'create',
    targetId: SITE,
    payload: {
      name: 'The garden',
      frost: { lastSpring: 515, firstAutumn: 1005, source: 'entered' },
    },
  });
  await enqueue({
    entity: 'bed',
    op: 'create',
    targetId: BED,
    payload: { siteId: SITE, name: 'Bed three', covered: false },
  });
  await enqueue({
    entity: 'bed',
    op: 'create',
    targetId: OTHER_BED,
    payload: { siteId: SITE, name: 'The tunnel', covered: true },
  });
  await enqueue({
    entity: 'variety',
    op: 'create',
    targetId: VARIETY,
    payload: {
      name: 'Roma',
      crop: 'Tomato',
      family: 'solanaceae',
      lifecycle: 'annual',
      daysToMaturity: 75,
    },
  });
  await enqueue({
    entity: 'planting',
    op: 'create',
    targetId: PLANTING,
    payload: {
      bedId: BED,
      varietyId: VARIETY,
      season: YEAR,
      status: 'in-ground',
      sownAt: new Date(`${YEAR}-04-03`).getTime(),
    },
  });
}

/** Four kilos off that planting, which is a fact about the bed and the variety. */
async function aHarvest(): Promise<void> {
  await enqueue({
    entity: 'harvest',
    op: 'create',
    targetId: newId(),
    payload: {
      occurredAt: Date.now(),
      plantingId: PLANTING,
      unit: 'mass',
      massUg: 4_000_000_000,
    },
  });
}

beforeEach(async () => {
  await freshStore();
});

describe('a bed', () => {
  it('says what is growing in it now', async () => {
    await aGarden();

    const screen = await mount(<BedScreen {...routeProps({ bedId: BED })} />);

    expect(screen.text()).toContain('Growing here now');
    expect(screen.text()).toContain('Roma');
    expect(screen.has(`growing-${PLANTING}`)).toBe(true);
    screen.unmount();
  });

  it('says whether it is under cover', async () => {
    await aGarden();

    const covered = await mount(<BedScreen {...routeProps({ bedId: OTHER_BED })} />);
    expect(covered.text()).toContain('Under cover');
    covered.unmount();

    const open = await mount(<BedScreen {...routeProps({ bedId: BED })} />);
    expect(open.text()).toContain('Open ground');
    open.unmount();
  });

  /**
   * The assertion this whole shape exists for. A harvest names the planting,
   * so a bed asking only for itself would show nothing at all — and the screen
   * would be a lie about a bed that had produced four kilos of tomatoes.
   */
  it('shows what came out of it, through the plantings that produced it', async () => {
    await aGarden();
    await aHarvest();

    const screen = await mount(<BedScreen {...routeProps({ bedId: BED })} />);

    expect(screen.text()).toContain('What came out of it');
    expect(screen.text()).toContain('Harvested');
    screen.unmount();
  });

  it('shows nothing from a bed next to it', async () => {
    await aGarden();
    await aHarvest();

    const screen = await mount(<BedScreen {...routeProps({ bedId: OTHER_BED })} />);

    expect(screen.text()).not.toContain('Harvested');
    screen.unmount();
  });

  /** An empty bed in spring is a decision waiting; it is not a broken screen. */
  it('says an empty bed is empty, in words', async () => {
    await aGarden();

    const screen = await mount(<BedScreen {...routeProps({ bedId: OTHER_BED })} />);

    expect(screen.text()).toContain('Nothing in it');
    screen.unmount();
  });

  it('lists what grew here before, which is the question a bed gets asked', async () => {
    await aGarden();
    const past = newId();
    await enqueue({
      entity: 'planting',
      op: 'create',
      targetId: past,
      payload: {
        bedId: BED,
        varietyId: VARIETY,
        season: YEAR - 1,
        status: 'finished',
        removedAt: new Date(`${YEAR - 1}-09-01`).getTime(),
      },
    });

    const screen = await mount(<BedScreen {...routeProps({ bedId: BED })} />);

    expect(screen.text()).toContain('Grown here before');
    expect(screen.has(`grown-${past}`)).toBe(true);
    screen.unmount();
  });

  it('opens from the growing screen, where the heading used to do nothing', async () => {
    await aGarden();

    const screen = await mount(<GrowingScreen />);

    expect(screen.has(`bed-${BED}`)).toBe(true);
    screen.unmount();
  });
});

describe('a variety', () => {
  /**
   * The numbers that decide every planned date this app produces, shown for
   * the first time. A keeper who disagrees with seventy-five days has to be
   * able to see seventy-five days.
   */
  it('shows what its dates are computed from', async () => {
    await aGarden();

    const screen = await mount(<VarietyScreen {...routeProps({ varietyId: VARIETY })} />);

    // `text()` joins string nodes with a space, so "about {75} days" arrives
    // as "about  75  days". That is the harness, not the screen.
    expect(screen.text().replace(/\s+/g, ' ')).toContain('75 days');
    expect(screen.text()).toContain('Tomato');
    screen.unmount();
  });

  it('says where it has been planted, and in which season', async () => {
    await aGarden();

    const screen = await mount(<VarietyScreen {...routeProps({ varietyId: VARIETY })} />);

    expect(screen.text()).toContain('Bed three');
    expect(screen.text()).toContain(String(YEAR));
    screen.unmount();
  });

  it('shows what it has given, through its plantings', async () => {
    await aGarden();
    await aHarvest();

    const screen = await mount(<VarietyScreen {...routeProps({ varietyId: VARIETY })} />);

    expect(screen.text()).toContain('What it has given');
    expect(screen.text()).toContain('Harvested');
    screen.unmount();
  });

  it('invites a first planting rather than showing an empty box', async () => {
    await aGarden();
    const unplanted = newId();
    await enqueue({
      entity: 'variety',
      op: 'create',
      targetId: unplanted,
      payload: { name: 'Musselburgh', crop: 'Leek', family: 'allium', lifecycle: 'biennial' },
    });

    const screen = await mount(<VarietyScreen {...routeProps({ varietyId: unplanted })} />);

    expect(screen.text()).toContain('Never planted');
    expect(screen.text()).toContain('Not in the ground yet');
    screen.unmount();
  });

  /**
   * A variety somebody added themselves has no library entry, so the app
   * cannot suggest dates for it — and should say that rather than showing an
   * empty panel that implies it knows something.
   */
  it('says plainly when it knows nothing about how a variety grows', async () => {
    await aGarden();
    const own = newId();
    await enqueue({
      entity: 'variety',
      op: 'create',
      targetId: own,
      payload: {
        name: "Grandad's beans",
        crop: 'Bean',
        family: 'legume',
        lifecycle: 'annual',
      },
    });

    const screen = await mount(<VarietyScreen {...routeProps({ varietyId: own })} />);

    expect(screen.text()).toContain('cannot suggest dates');
    screen.unmount();
  });
});
