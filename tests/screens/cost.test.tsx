import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { feedCostPerEgg } from '@steading/core/read/cost';
import { listInventory } from '@steading/core/read/iron';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { AddItemScreen } from '../../apps/mobile/src/screens/AddItemScreen';
import { FeedScreen } from '../../apps/mobile/src/screens/FeedScreen';
import { TrendScreen } from '../../apps/mobile/src/screens/TrendScreen';

/**
 * A price on the shelf becoming a cost per egg.
 *
 * The chain is four links long — the shelf entry stores a rate, the feed
 * screen stamps a cost from it, the read divides, the screen refuses when the
 * coverage is thin — and every link is somewhere a plausible wrong number
 * could be produced instead of no number. Tested end to end for that reason.
 */

const GROUP = newId();
const PELLETS = newId();

async function farm(): Promise<void> {
  await freshStore();
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'Breeding Crew', species: 'chicken', count: 10, purposes: ['eggs'] },
  });
}

/** A 50 lb sack of pellets at $22.50 — 45¢ a pound. */
async function pricedSack(costCents?: number): Promise<void> {
  await enqueue({
    entity: 'inventory',
    op: 'create',
    targetId: PELLETS,
    payload: {
      name: 'Layer pellets',
      kind: 'feed',
      unit: 'lb',
      quantity: 50,
      ...(costCents === undefined ? {} : { costCents }),
    },
  });
}

/** Puts two pounds through the feed screen, the way a keeper would. */
async function feedTwoPounds(): Promise<void> {
  const screen = await mount(<FeedScreen {...routeProps({ groupId: GROUP })} />);

  await screen.pressLabel('Layer pellets');
  await screen.press('tally-plus-1');
  await screen.press('tally-plus-1');
  await screen.press('tally-commit');

  screen.unmount();
}

beforeEach(async () => {
  await farm();
});

describe('putting a price on the shelf', () => {
  /**
   * A farm knows what it paid for the sack. It does not know, and should not
   * work out standing in a feed store, what one pound of it costs.
   */
  it('takes what the lot cost and stores what one unit costs', async () => {
    const screen = await mount(<AddItemScreen {...routeProps({})} />);
    await screen.type('item-name', 'Layer pellets');
    await screen.pressLabel('Pounds');

    // Starts at 1; four taps of +5 makes it a 21 lb sack.
    for (let i = 0; i < 4; i += 1) await screen.press('item-quantity-plus-5');
    await screen.type('item-paid', '10.50');

    // The hint is what proves the division happened, and it is the only place
    // a person can see it before saving. 10.50 across 21 lb is 50¢ a pound.
    expect(screen.text().replace(/\s+/g, ' ')).toContain('$0.50 per lb');

    await screen.press('save-item');
    const [item] = await listInventory();
    expect(item?.costCents).toBe(50);
  });

  it('stores nothing when nobody said what it cost', async () => {
    const screen = await mount(<AddItemScreen {...routeProps({})} />);
    await screen.type('item-name', 'Layer pellets');
    await screen.press('save-item');

    // Absent, not zero. A zero rate would make every feeding free and drag a
    // cost per egg down without ever looking wrong.
    const per = await feedCostPerEgg(GROUP, 30);
    expect(per.costed).toBe(0);
  });
});

describe('feeding from a priced sack', () => {
  it('stamps what the feeding cost', async () => {
    await pricedSack(45);
    await feedTwoPounds();

    const per = await feedCostPerEgg(GROUP, 30);
    expect(per.spent).toBe(90);
    expect(per.costed).toBe(1);
  });

  /**
   * The whole reason an append-only log is append-only. Feed prices move
   * across a season, and April's cost must stay April's — a read that
   * multiplied last spring's tonnage by today's sack would show a farm a cost
   * it never paid and call it history.
   */
  it('keeps the old cost when the sack is repriced', async () => {
    await pricedSack(45);
    await feedTwoPounds();

    await enqueue({
      entity: 'inventory',
      op: 'update',
      targetId: PELLETS,
      payload: { costCents: 90 },
    });

    const per = await feedCostPerEgg(GROUP, 30);
    expect(per.spent).toBe(90);
  });

  it('stamps nothing from a sack with no price', async () => {
    await pricedSack();
    await feedTwoPounds();

    const per = await feedCostPerEgg(GROUP, 30);
    expect(per.feedings).toBe(1);
    expect(per.costed).toBe(0);
  });
});

describe('what the screen says', () => {
  async function eggs(count: number): Promise<void> {
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now(), flockId: GROUP, count },
    });
  }

  it('shows the figure once the feed is priced', async () => {
    await pricedSack(45);
    await feedTwoPounds();
    await eggs(9);

    const screen = await mount(<TrendScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.has('cost-per-egg')).toBe(true);
    // 90¢ across 9 eggs is ten cents each.
    expect(screen.text()).toContain('$0.100');
  });

  /**
   * Feed is sixty to seventy-five per cent of what a laying flock costs. That
   * is what makes a feed-only figure worth having, and what makes an
   * unqualified one a lie.
   */
  it('says the figure is feed only', async () => {
    await pricedSack(45);
    await feedTwoPounds();
    await eggs(9);

    const screen = await mount(<TrendScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.text()).toContain('In feed');
  });

  /**
   * The refusal that matters. Half the feedings priced divides half the cost
   * by all of the eggs and reports half the true figure — which reads low,
   * looks right, and is the reason a farm would stop trusting the screen.
   */
  it('refuses a figure built from part of the feed', async () => {
    await pricedSack(45);
    await feedTwoPounds();

    // Three more feeds, unpriced — a quarter of the window carries a price.
    await enqueue({
      entity: 'inventory',
      op: 'update',
      targetId: PELLETS,
      payload: { costCents: undefined },
    });
    for (let i = 0; i < 3; i += 1) {
      await enqueue({
        entity: 'feedLog',
        op: 'create',
        targetId: newId(),
        payload: { occurredAt: Date.now(), flockId: GROUP, amountGrams: 908 },
      });
    }
    await eggs(9);

    const screen = await mount(<TrendScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.has('cost-per-egg')).toBe(false);
    expect(screen.text().replace(/\s+/g, ' ')).toContain('1 of the last 4 feeds');
  });

  it('tells a farm how to get the figure when nothing is priced', async () => {
    await pricedSack();
    await feedTwoPounds();
    await eggs(9);

    const screen = await mount(<TrendScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.text()).toContain('Put what a sack cost on the shelf entry');
  });

  /** A farm that has not fed anything is not a farm with a costing problem. */
  it('says nothing at all before there is any feed', async () => {
    await eggs(9);

    const screen = await mount(<TrendScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.text()).not.toContain('Cost per egg');
  });
});
