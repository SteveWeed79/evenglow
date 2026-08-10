import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { listInventory } from '@steading/core/read/iron';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { FeedScreen } from '../../apps/mobile/src/screens/FeedScreen';

/**
 * Feeding takes it off the shelf.
 *
 * Reported from a handset: *"When I log a feeding for 3 lb of layer pellets
 * the shelf's numbers do not reduce. Layer pellets should be 47 after the
 * feeding."*
 *
 * The screen held the shelf still **on purpose**, and the reasoning is worth
 * keeping because half of it is still right: *how much of a 50 lb sack a scoop
 * represents is a guess, and a quantity that drifts away from what is on the
 * floor is worse than one nobody touched.*
 *
 * True of scoops. Not true of pounds. Fifty minus three is forty-seven, and
 * the hold had been applied to a case with nothing to guess about.
 */

const GROUP = newId();
const PELLETS = newId();

async function shelfItem(
  id: string,
  over: Record<string, unknown> = {},
): Promise<void> {
  await enqueue({
    entity: 'inventory',
    op: 'create',
    targetId: id,
    payload: {
      name: 'Layer pellets',
      kind: 'feed',
      unit: 'lb',
      quantity: 50,
      reorderBelow: 5,
      ...over,
    },
  });
}

beforeEach(async () => {
  await freshStore();
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'Breeding Crew', species: 'chicken', count: 10, purposes: ['eggs'] },
  });
});

/** Picks the sack, sets the measure, and commits `count`. */
async function feed(count: number, measure?: string): Promise<void> {
  const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);

  await screen.pressLabel('Layer pellets');
  if (measure !== undefined) await screen.pressLabel(measure);
  for (let i = 0; i < count; i += 1) await screen.press('tally-plus-1');
  await screen.press('tally-commit');

  screen.unmount();
}

describe('feeding a weighed sack', () => {
  /** The report, exactly. */
  it('leaves 47 lb after 3 lb of a 50 lb sack', async () => {
    await shelfItem(PELLETS);

    await feed(3);

    const [item] = await listInventory();
    expect(item?.quantity).toBe(47);
  });

  /**
   * Picking the sack already copies its unit into the measure, so the common
   * path needs no second choice — which is the condition that makes the sum
   * safe in the first place.
   */
  it('adopts the sack’s unit when it is picked', async () => {
    await shelfItem(PELLETS);

    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);
    await screen.pressLabel('Layer pellets');

    expect(screen.text()).toContain('Comes off the shelf');
    // `text()` joins string nodes with spaces, so "{n} {unit} left" arrives
    // padded. That is the harness, not the screen.
    expect(screen.text().replace(/\s+/g, ' ')).toContain('50 lb left');
    screen.unmount();
  });

  /** A sack fed past empty says empty. `quantity` is non-negative. */
  it('stops at zero rather than going negative', async () => {
    await shelfItem(PELLETS, { quantity: 2 });

    await feed(5);

    expect((await listInventory())[0]?.quantity).toBe(0);
  });

  /**
   * Two sacks of the same feed is an ordinary thing to own. The open one is
   * finished first, which is what a farm actually does.
   */
  it('draws from the open bag rather than the full one', async () => {
    const nearlyOut = newId();
    await shelfItem(PELLETS);
    await shelfItem(nearlyOut, { quantity: 12 });

    await feed(4);

    const items = await listInventory();
    expect(items.find((one) => one.id === nearlyOut)?.quantity).toBe(8);
    expect(items.find((one) => one.id === PELLETS)?.quantity).toBe(50);
  });
});

/**
 * "Should we remove scoop or have the user define it?"
 *
 * Define it. The scoop is the unit a farm actually uses, twice a day, with a
 * glove on — removing it would be the app being pedantic about the one measure
 * that gets used. What was wrong was never the scoop; it was the app GUESSING
 * at it, and then not being able to draw the sack down because of its own
 * guess.
 */
describe('feeding by the scoop, before the farm has said what a scoop is', () => {
  it('changes nothing, because the app is still guessing', async () => {
    await shelfItem(PELLETS);

    await feed(2, 'Scoops');

    expect((await listInventory())[0]?.quantity).toBe(50);
  });

  /**
   * And asks, where it is noticed — somebody holding the scoop wondering why
   * the number did not move is exactly who can answer.
   */
  it('asks what the scoop holds', async () => {
    await shelfItem(PELLETS);

    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);
    await screen.pressLabel('Layer pellets');
    await screen.pressLabel('Scoops');

    expect(screen.text()).toContain('How much does your scoop hold?');
    expect(screen.has('feed-scoop-size')).toBe(true);
    screen.unmount();
  });
});

describe('once the farm has said what a scoop is', () => {
  it('remembers it on that sack', async () => {
    await shelfItem(PELLETS);

    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);
    await screen.pressLabel('Layer pellets');
    await screen.pressLabel('Scoops');
    await screen.type('feed-scoop-size', '1.5');
    await screen.press('feed-scoop-save');
    screen.unmount();

    // 1.5 lb, in grams.
    expect((await listInventory())[0]?.scoopGrams).toBe(681);
  });

  /** And a scoop stops being a guess, so the sack comes down like pounds do. */
  it('takes scoops off the shelf, at the farm’s own weight', async () => {
    await shelfItem(PELLETS, { scoopGrams: 908 });

    await feed(2, 'Scoops');

    // Two 2 lb scoops out of fifty.
    expect((await listInventory())[0]?.quantity).toBe(46);
  });

  it('says it is coming off, rather than asking again', async () => {
    await shelfItem(PELLETS, { scoopGrams: 908 });

    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);
    await screen.pressLabel('Layer pellets');
    await screen.pressLabel('Scoops');

    expect(screen.text()).toContain('Comes off the shelf');
    expect(screen.text()).not.toContain('How much does your scoop hold?');
    screen.unmount();
  });

  /** The record gets the farm's figure too, not the 907 g estimate. */
  it('logs what was actually fed', async () => {
    await shelfItem(PELLETS, { scoopGrams: 1500 });

    await feed(2, 'Scoops');

    const { localStore } = await import('@steading/core/db/store');
    const [record] = await localStore().readRecordsByEntity('feedLog');
    // 3000 g rather than the 1814 g the old estimate would have written.
    expect(record?.value).toMatchObject({ amountGrams: 3000 });
  });
});

describe('feeding something that is not on the shelf', () => {
  it('records the feed and touches no sack', async () => {
    await shelfItem(PELLETS);

    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);
    await screen.type('feed-type', "The neighbour's hay");
    await screen.pressLabel('Pounds');
    await screen.press('tally-plus-1');
    await screen.press('tally-commit');
    screen.unmount();

    expect((await listInventory())[0]?.quantity).toBe(50);
  });

  /** A sack counted in bags says nothing about what goes in a trough. */
  it('leaves a sack counted in bags alone, and says why', async () => {
    await shelfItem(PELLETS, { unit: 'bag', quantity: 3 });

    await feed(2, 'Pounds');

    expect((await listInventory())[0]?.quantity).toBe(3);

    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);
    await screen.pressLabel('Layer pellets');
    expect(screen.text().replace(/\s+/g, ' ')).toContain('counted in bag');
    screen.unmount();
  });
});

describe('what is written', () => {
  /**
   * The record comes first and the shelf second. What was fed is the fact;
   * what is left is bookkeeping derived from it, and if only one survives the
   * one worth keeping is the feed.
   */
  it('records the feed itself, in grams, whatever happens to the shelf', async () => {
    await shelfItem(PELLETS);

    await feed(3);

    const { listHistory } = await import('@steading/core/read/history');
    const events = (await listHistory('imperial')).flatMap((day) => day.events);
    expect(events.some((one) => one.entity === 'feedLog')).toBe(true);
  });
});

/**
 * A shelf a farm can actually reach past.
 *
 * Feed names are long — "Purina Medicated Chick Starter" is a chip that takes
 * a row on its own — so the list wraps to roughly one row per sack and the
 * Tally, which is the control somebody opened this screen to use, goes below
 * the fold at about six. A cap rather than a picker: UX-SPEC §5 rules out a
 * modal wheel that cannot be read in sunlight, and this screen is used in a
 * barn with a scoop in one hand.
 */
describe('a shelf with a lot on it', () => {
  async function stock(names: string[], over: Record<string, unknown> = {}): Promise<void> {
    for (const name of names) await shelfItem(newId(), { name, ...over });
  }

  it('shows the first few and keeps the rest one tap away', async () => {
    await stock(['Feed A', 'Feed B', 'Feed C', 'Feed D', 'Feed E', 'Feed F', 'Feed G', 'Feed H']);
    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);

    expect(screen.text()).toContain('Feed A');
    // Eight on the shelf, six drawn.
    expect(screen.text()).not.toContain('Feed H');
    // Collapsed, because the harness joins interpolated JSX with spaces.
    expect(screen.text().replace(/\s+/g, ' ')).toContain('Show all 8 on the shelf');

    await screen.press('feed-show-all');

    expect(screen.text()).toContain('Feed H');
    screen.unmount();
  });

  it('does not offer a disclosure for a shelf that already fits', async () => {
    await stock(['Feed A', 'Feed B']);
    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);

    expect(screen.text()).toContain('Feed B');
    expect(screen.has('feed-show-all')).toBe(false);
    screen.unmount();
  });

  /**
   * The tag sorts and never filters — a keeper putting scratch in front of the
   * goats because it is the sack that is open is doing an ordinary thing. So
   * another species' feed goes behind the cap rather than out of existence.
   */
  it('puts another species feed behind the cap rather than hiding it', async () => {
    await stock(['Feed A', 'Feed B', 'Feed C', 'Feed D', 'Feed E', 'Feed F']);
    await shelfItem(newId(), { name: 'Sweet Feed', species: ['goat'] });

    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);

    // Feeding chickens, so the goat sack sorts last and falls past six.
    expect(screen.text()).not.toContain('Sweet Feed');

    await screen.press('feed-show-all');

    expect(screen.text()).toContain('Sweet Feed');
    screen.unmount();
  });
});

/**
 * What they had last time, first.
 *
 * A farm gives the same sack every morning, so the previous feed is a better
 * guess than the label on the bag. `feedType` has been on the record since the
 * schema was written and the reader threw it away.
 */
describe('the sack they had last time', () => {
  it('is named on the screen rather than only dated', async () => {
    await shelfItem(PELLETS);
    await feed(3, 'Pounds');

    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);

    expect(screen.text()).toContain('Layer pellets');
    screen.unmount();
  });

  it('sorts ahead of a sack that merely suits the species', async () => {
    // Six chicken-suitable sacks would push a seventh past the cap. The one
    // they actually had last stays visible because it sorts to the front.
    await shelfItem(newId(), { name: 'Sweet Feed', species: ['goat'] });
    for (const name of ['Feed A', 'Feed B', 'Feed C', 'Feed D', 'Feed E', 'Feed F']) {
      await shelfItem(newId(), { name });
    }

    // Feed the goat sack to these chickens — unusual, allowed, and recorded.
    const first = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);
    await first.press('feed-show-all');
    await first.pressLabel('Sweet Feed');
    await first.press('tally-plus-1');
    await first.press('tally-commit');
    first.unmount();

    const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);

    // Without the recency tier it would sort last and sit behind the cap.
    expect(screen.text()).toContain('Sweet Feed');
    screen.unmount();
  });
});
