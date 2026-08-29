import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import {
  bucketStart,
  bucketsBack,
  direction,
  eggTrend,
  feedTrend,
  produceTrend,
} from '@homefarm/core/read/trend';
import { enqueue } from '@homefarm/core/sync/queue';
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

/**
 * ── The clocks going forward, which emptied five columns of six ────────────
 *
 * Every bucket boundary here is *local* midnight, which is what makes a week a
 * week a farm recognises. `bucketsBack` stepped between those boundaries by
 * `7 * 86_400_000` ms — and twice a year a week is not that many milliseconds.
 * One step across a transition lands an hour off midnight and every step after
 * it stays an hour off.
 *
 * The failure is total rather than partial: `into()` keys buckets by
 * `bucketStart` and looks records up by the same function, so a bucket that is
 * not itself a bucket start can never be matched by anything. A farm that
 * logged ten eggs every Tuesday for twenty weeks, charted on 10 March 2025 in
 * `America/New_York`, saw `0, 0, 0, 0, 10`.
 *
 * ## Why nothing here could see it
 *
 * **The timezone is the fixture, and it was never set.** A test machine and a
 * CI runner are both UTC, and UTC has no daylight saving — so every step
 * between local midnights happened to be exactly a day and every assertion
 * above passed. A scan of four years of windows reports 41,717 misplaced
 * buckets in `America/New_York` and **0 in UTC**.
 *
 * So this block sets the timezone and puts it back. `fileParallelism: false`
 * means one process for the whole suite, so leaving it set would quietly
 * re-time every file that runs after this one.
 */
describe('a window that crosses a daylight-saving transition', () => {
  const WAS = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'America/New_York';
  });

  afterAll(() => {
    if (WAS === undefined) delete process.env.TZ;
    else process.env.TZ = WAS;
  });

  /** 14:00 on Monday 24 March 2025, two weeks after the clocks went forward. */
  const AFTER = Date.parse('2025-03-24T18:00:00Z');

  /** Midday on a day of the given week, keyed by the calendar rather than by ms. */
  function midweek(weekStart: number, dayOffset: number): number {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + dayOffset);
    date.setHours(12, 0, 0, 0);
    return date.getTime();
  }

  /**
   * **The property the whole scheme rests on.** A bucket must be its own
   * `bucketStart`, because that is the only way a record can ever be filed into
   * it. Three of these six were `Sun 23:00` and could not be.
   */
  it('gives every week a Monday midnight that is its own bucket start', () => {
    for (const at of bucketsBack(6, 'week', AFTER)) {
      const when = new Date(at).toString();

      expect(new Date(at).getDay(), when).toBe(1);
      expect(new Date(at).getHours(), when).toBe(0);
      expect(bucketStart(at, 'week'), when).toBe(at);
    }
  });

  /**
   * The whole bug, from the outside: a collection in every week, and every
   * week has to show it. Before the fix the three weeks older than the
   * transition read 0 whatever had been logged.
   */
  it('does not empty the weeks older than the transition', async () => {
    const weeks = bucketsBack(6, 'week', AFTER);
    for (const [index, week] of weeks.entries()) {
      // Tuesday, so the collection is unambiguously inside its own week and
      // not sitting on a boundary either version could argue about.
      await eggs(midweek(week, 1), index + 1);
    }

    const points = await eggTrend(GROUP, 'week', 6, AFTER);
    expect(points.map((point) => point.amount)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  /**
   * ── One correction to the finding this fixes ─────────────────────────────
   *
   * H12 says `direction()` "reports a fabricated collapse". It does not, and
   * the difference is worth pinning so nobody re-derives it: the emptied
   * buckets run contiguously backwards from the transition, so the two buckets
   * `direction` compares are almost always in the same regime. When the
   * boundary does fall between them the older one is the empty one, and
   * dividing by an empty week is already refused — so the answer is `null`.
   *
   * Measured on the shape above, charted week by week through March 2025:
   * `0`, `null`, `null`, `0`, `0`, `0`. Never a false percentage.
   *
   * **Which is its own harm rather than a smaller one.** The sentence is the
   * part that survives being read at arm's length in a yard, and it went
   * missing on exactly the two weeks the chart looked most alarming — five
   * empty columns and no explanation. This asserts it is back.
   */
  it('can say what it is worth saying again, on the weeks it went silent', async () => {
    // Ten eggs every Tuesday for twenty weeks, ending after the transition.
    let tuesday = new Date(Date.parse('2025-01-07T17:00:00Z'));
    for (let week = 0; week < 20; week++) {
      await eggs(tuesday.getTime(), 10);
      const next = new Date(tuesday.getTime());
      next.setDate(next.getDate() + 7);
      tuesday = next;
    }

    // The Monday a week after the clocks changed: the chart that read
    // 0, 0, 0, 0, 0, 10 and offered no comparison at all.
    const points = await eggTrend(GROUP, 'week', 6, Date.parse('2025-03-10T18:00:00Z'));

    expect(points.slice(0, 5).map((point) => point.amount)).toEqual([10, 10, 10, 10, 10]);
    expect(direction(points).changePercent).toBe(0);
  });
});

/**
 * ── The month chart, and a timezone that changes at midnight ───────────────
 *
 * A separate block because `America/New_York` cannot show this. Its clocks move
 * at 02:00, so the 1st of a month always has a midnight and the month path
 * looked correct there under every date tried — a bug that hides behind the
 * timezone chosen to test the other one.
 *
 * Beirut moves at 00:00. On 31 March 2024 the day has no midnight, so
 * `setHours(0, 0, 0, 0)` lands on 01:00, `setDate(1)` keeps 01:00, and every
 * step back keeps it too. **All six buckets were 01:00 and not one of them was
 * matchable** — a whole year's month chart at zero, not three columns of six.
 * `America/Santiago` does the same on 8 September 2024.
 *
 * Found by scanning twelve years of windows across twelve timezones rather than
 * by reasoning about it: the reasoning said the month path was fine.
 */
describe('a month window in a timezone whose clocks move at midnight', () => {
  const WAS = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'Asia/Beirut';
  });

  afterAll(() => {
    if (WAS === undefined) delete process.env.TZ;
    else process.env.TZ = WAS;
  });

  /** Midday on 31 March 2024 in Beirut — the day that has no 00:00. */
  const ON_THE_DAY = Date.parse('2024-03-31T09:00:00Z');

  it('gives every month a first-of-the-month start that is its own bucket start', () => {
    for (const at of bucketsBack(6, 'month', ON_THE_DAY)) {
      const when = new Date(at).toString();

      expect(new Date(at).getDate(), when).toBe(1);
      expect(bucketStart(at, 'month'), when).toBe(at);
    }
  });

  it('does not empty a year of month columns', async () => {
    const months = bucketsBack(6, 'month', ON_THE_DAY);
    for (const [index, month] of months.entries()) {
      // The 10th, well clear of either end of the month.
      const day = new Date(month);
      day.setDate(10);
      day.setHours(12, 0, 0, 0);
      await eggs(day.getTime(), index + 1);
    }

    const points = await eggTrend(GROUP, 'month', 6, ON_THE_DAY);
    expect(points.map((point) => point.amount)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
