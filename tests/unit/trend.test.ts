import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import {
  bucketStart,
  bucketsBack,
  direction,
  eggTrend,
  feedTrend,
  produceTrend,
} from '@steading/core/read/trend';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';

/**
 * A season, bucketed.
 *
 * There was not one chart in the app. A farm could log every morning for a
 * year and had no way to see whether the flock was slowing — the difference
 * between a logbook and a tool.
 *
 * The bucketing is where a chart lies if it is wrong, so it is tested here
 * without a screen: an off-by-one week puts a fortnight of eggs in the wrong
 * column and nothing about the picture says so.
 */

const DAY = 86_400_000;
const GROUP = newId();
const OTHER = newId();

/** A Wednesday, so the week boundary is not accidentally the same as the day. */
const NOW = Date.parse('2026-08-05T14:00:00Z');

async function eggs(at: number, count: number, flockId = GROUP): Promise<void> {
  await enqueue({
    entity: 'eggLog',
    op: 'create',
    targetId: newId(),
    payload: { occurredAt: at, flockId, count },
  });
}

beforeEach(async () => {
  await freshStore();
});

describe('where a moment falls', () => {
  /**
   * A farm's week starts on Monday. `getDay()` calls Sunday zero, so a naive
   * bucket would put Sunday's eggs at the START of the week that had not begun
   * — the one day of the seven where being wrong is invisible until somebody
   * compares two columns.
   */
  it('puts a week on the Monday before it', () => {
    const wednesday = Date.parse('2026-08-05T14:00:00Z');
    const monday = new Date(bucketStart(wednesday, 'week'));

    expect(monday.getDay()).toBe(1);
    expect(monday.getHours()).toBe(0);
  });

  it('puts Sunday at the end of its week, not the start of the next', () => {
    const sunday = Date.parse('2026-08-09T20:00:00Z');
    const monday = Date.parse('2026-08-03T09:00:00Z');

    expect(bucketStart(sunday, 'week')).toBe(bucketStart(monday, 'week'));
  });

  it('puts a month on its first', () => {
    const first = new Date(bucketStart(Date.parse('2026-08-22T14:00:00Z'), 'month'));
    expect(first.getDate()).toBe(1);
    expect(first.getMonth()).toBe(7);
  });
});

describe('the window', () => {
  it('is always the same width, however little the farm has logged', () => {
    expect(bucketsBack(12, 'week', NOW)).toHaveLength(12);
    expect(bucketsBack(12, 'month', NOW)).toHaveLength(12);
  });

  it('runs oldest first and ends with the one in progress', () => {
    const weeks = bucketsBack(12, 'week', NOW);

    expect(weeks[0]).toBeLessThan(weeks[11]!);
    expect(weeks[11]).toBe(bucketStart(NOW, 'week'));
  });

  /** Months are not 30 days. Stepping by a fixed span drifts across a year. */
  it('steps months by the calendar rather than by a fixed span', () => {
    const months = bucketsBack(12, 'month', Date.parse('2026-03-15T00:00:00Z'));
    const first = new Date(months[0]!);

    expect(first.getDate()).toBe(1);
    // Twelve months back from March 2026 is April 2025.
    expect(first.getFullYear()).toBe(2025);
    expect(first.getMonth()).toBe(3);
  });
});

describe('what lands in a bucket', () => {
  it('sums a week of collections into one column', async () => {
    const monday = bucketStart(NOW, 'week');
    await eggs(monday + 2 * DAY, 6);
    await eggs(monday + 3 * DAY, 5);

    const points = await eggTrend(GROUP, 'week', 12, NOW);
    expect(points[11]?.amount).toBe(11);
  });

  /**
   * A week with nothing in it is a real answer. Dropping empties would draw a
   * chart that skips the fortnight nobody collected — exactly the fortnight
   * worth seeing.
   */
  it('keeps a week with nothing in it', async () => {
    await eggs(NOW - 21 * DAY, 30);

    const points = await eggTrend(GROUP, 'week', 12, NOW);
    expect(points).toHaveLength(12);
    expect(points.filter((point) => point.amount === 0).length).toBeGreaterThan(5);
  });

  it('leaves out another group’s eggs', async () => {
    await eggs(NOW - DAY, 12, OTHER);

    const points = await eggTrend(GROUP, 'week', 12, NOW);
    expect(points.every((point) => point.amount === 0)).toBe(true);
  });

  /** A farm with three years of records charts twelve weeks, not three years. */
  it('ignores anything older than the window', async () => {
    await eggs(NOW - 400 * DAY, 999);
    await eggs(NOW - DAY, 7);

    const points = await eggTrend(GROUP, 'week', 12, NOW);
    expect(points.reduce((sum, point) => sum + point.amount, 0)).toBe(7);
  });

  it('separates one kind of produce from another', async () => {
    for (const kind of ['milk', 'fibre'] as const) {
      await enqueue({
        entity: 'productionLog',
        op: 'create',
        targetId: newId(),
        payload: {
          occurredAt: NOW - DAY,
          flockId: GROUP,
          kind,
          amount: kind === 'milk' ? 2000 : 500,
          unit: kind === 'milk' ? 'ml' : 'g',
        },
      });
    }

    const milk = await produceTrend(GROUP, 'milk', 'week', 12, NOW);
    const fibre = await produceTrend(GROUP, 'fibre', 'week', 12, NOW);

    expect(milk[11]?.amount).toBe(2000);
    expect(fibre[11]?.amount).toBe(500);
  });

  it('charts feed in the grams it was stored in', async () => {
    await enqueue({
      entity: 'feedLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: NOW - DAY, flockId: GROUP, amountGrams: 1362 },
    });

    const points = await feedTrend(GROUP, 'week', 12, NOW);
    expect(points[11]?.amount).toBe(1362);
  });
});

describe('what the chart is worth saying', () => {
  /**
   * The bucket in progress is always low because it is not over. Comparing it
   * would announce a collapse every Monday morning, and a chart that cries
   * wolf weekly is one nobody reads by the second week.
   */
  it('skips the week in progress and compares the two complete ones', () => {
    const points = [
      { at: 1, amount: 10 },
      { at: 2, amount: 100 },
      { at: 3, amount: 120 },
      // Monday morning: barely anything logged yet.
      { at: 4, amount: 3 },
    ];

    const moved = direction(points);
    expect(moved.latest?.amount).toBe(120);
    expect(moved.previous?.amount).toBe(100);
    expect(moved.changePercent).toBe(20);
  });

  it('says nothing when there is not enough to compare', () => {
    expect(direction([{ at: 1, amount: 5 }]).changePercent).toBeNull();
    expect(direction([]).latest).toBeNull();
  });

  /** Dividing by a week that produced nothing is not a percentage. */
  it('does not divide by an empty week', () => {
    const moved = direction([
      { at: 1, amount: 0 },
      { at: 2, amount: 0 },
      { at: 3, amount: 40 },
      { at: 4, amount: 2 },
    ]);

    expect(moved.changePercent).toBeNull();
    expect(moved.latest?.amount).toBe(40);
  });

  it('reads a fall as a fall', () => {
    const moved = direction([
      { at: 1, amount: 0 },
      { at: 2, amount: 100 },
      { at: 3, amount: 60 },
      { at: 4, amount: 5 },
    ]);

    expect(moved.changePercent).toBe(-40);
  });
});
