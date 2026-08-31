import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { TrendScreen } from '../../apps/mobile/src/screens/TrendScreen';

/**
 * The season, on a screen.
 *
 * The projection is tested without a screen in `tests/unit/trend.test.ts`;
 * this is the half that only mounting catches — that the chart is reachable at
 * all, that it says something in words rather than only in bars, and that a
 * farm with nothing logged is told so instead of being shown twelve empty
 * columns and left to work out whether that is the answer or a failure.
 */

const DAY = 86_400_000;
const GROUP = newId();

async function farm(over: Record<string, unknown> = {}): Promise<void> {
  await freshStore();
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: {
      name: 'Breeding Crew',
      species: 'chicken',
      count: 10,
      purposes: ['eggs'],
      ...over,
    },
  });
}

async function eggs(daysAgo: number, count: number): Promise<void> {
  await enqueue({
    entity: 'eggLog',
    op: 'create',
    targetId: newId(),
    payload: { occurredAt: Date.now() - daysAgo * DAY, flockId: GROUP, count },
  });
}

beforeEach(async () => {
  await farm();
});

describe('the numbers', () => {
  it('charts what the group produces', async () => {
    await eggs(10, 40);

    const screen = await mount(<TrendScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.has('trend-eggs')).toBe(true);
  });

  /**
   * A shape says something is happening; a sentence says what. On a phone read
   * at arm's length in a yard the sentence is the part that survives, so a
   * chart without one has not delivered the feature.
   */
  it('says which way it is going, in words', async () => {
    // Two complete weeks, the older one lower — a rise the caption must name.
    await eggs(16, 100);
    await eggs(9, 120);

    const screen = await mount(<TrendScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.text()).toContain('%');
  });

  it('offers the year as well as the season', async () => {
    await eggs(3, 12);

    const screen = await mount(<TrendScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.labels()).toContain('12 weeks');
    expect(screen.labels()).toContain('12 months');

    await screen.pressLabel('12 months');
    expect(screen.has('trend-eggs')).toBe(true);
  });

  /**
   * The axis named the wrong bucket on one of the two chips.
   *
   * `Trend` hardcoded "this week" under its last column, so the twelve-MONTH
   * chart announced its final bar as a week. A two-state bug where one state is
   * right is the kind that survives every reading of the component — the string
   * is correct in the file, and only the other chip disagrees — so it takes a
   * test that presses the chip.
   */
  it('names the bucket the chips actually selected', async () => {
    await eggs(3, 12);

    const screen = await mount(<TrendScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.text()).toContain('this week');
    expect(screen.text()).not.toContain('this month');

    await screen.pressLabel('12 months');
    expect(screen.text()).toContain('this month');
    expect(screen.text()).not.toContain('this week');
  });

  /**
   * Two numbers a line apart that measure different things, with nothing saying
   * so: the figure by the axis is the tallest bucket in the window, and the
   * sentence under it is the last COMPLETE bucket. Reported off the tablet as
   * the screen making no sense, and it does not — "56 eggs" over "6 eggs last
   * time round" is a contradiction until one of them says what it is.
   */
  it('says the scale figure is a peak rather than a total', async () => {
    await eggs(16, 100);
    await eggs(9, 120);

    const screen = await mount(<TrendScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.text()).toContain('most ');
  });

  /**
   * A farm that has just installed the app must be told the window is empty,
   * not shown a flat chart it has to interpret. Twelve zero-height bars and no
   * words is indistinguishable from a broken read.
   */
  it('says so when there is nothing in the window yet', async () => {
    const screen = await mount(<TrendScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.text()).toContain('Nothing logged in this window yet');
  });

  /** Feed is only half the picture when there is feed. */
  it('charts feed alongside production once any is logged', async () => {
    await eggs(3, 12);

    let screen = await mount(<TrendScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.has('trend-feed')).toBe(false);

    await enqueue({
      entity: 'feedLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now() - 2 * DAY, flockId: GROUP, amountGrams: 2724 },
    });

    screen = await mount(<TrendScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.has('trend-feed')).toBe(true);
    // Stored in grams, read in the farm's own units — 2724 g is a little over
    // six pounds, and grams on an imperial farm's chart would be the same
    // hardcoding this pass removed everywhere else.
    expect(screen.text()).toContain('lb');
  });

  /**
   * Charting what a group cannot produce is the mistake `productsOf` was
   * written for — a flock of hens offered a milk chart it will never fill.
   */
  it('charts only what this group is kept for', async () => {
    await farm({ species: 'goat', purposes: ['milk'], name: 'The Does' });
    await enqueue({
      entity: 'productionLog',
      op: 'create',
      targetId: newId(),
      payload: {
        occurredAt: Date.now() - 2 * DAY,
        flockId: GROUP,
        kind: 'milk',
        amount: 2000,
        unit: 'ml',
      },
    });

    const screen = await mount(<TrendScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.has('trend-milk')).toBe(true);
    expect(screen.has('trend-eggs')).toBe(false);
  });
});
