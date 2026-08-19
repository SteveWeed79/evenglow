import { beforeEach, describe, expect, it } from 'vitest';
import { formatMoney, formatRate, minorPer, newId } from '@homefarm/contracts';
import { feedCostPerEgg, feedSpend } from '@homefarm/core/read/cost';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';

/**
 * What a flock costs to keep, against what it gives back.
 *
 * Cost per egg is the figure a smallholding cannot get out of a spreadsheet
 * without an afternoon's work, so everybody has an opinion about it and nobody
 * has evidence. It is also the easiest number in this app to get quietly
 * wrong: divide a month of feed by a year of eggs, or a half-priced window by
 * a full production count, and the answer is plausible, low, and false.
 *
 * The refusals are tested harder than the arithmetic for that reason.
 */

const DAY = 86_400_000;
const GROUP = newId();
const OTHER = newId();
const NOW = Date.parse('2026-08-05T14:00:00Z');

async function fed(daysAgo: number, costCents?: number, flockId = GROUP): Promise<void> {
  await enqueue({
    entity: 'feedLog',
    op: 'create',
    targetId: newId(),
    payload: {
      occurredAt: NOW - daysAgo * DAY,
      flockId,
      amountGrams: 1362,
      ...(costCents === undefined ? {} : { costCents }),
    },
  });
}

async function collected(daysAgo: number, count: number, flockId = GROUP): Promise<void> {
  await enqueue({
    entity: 'eggLog',
    op: 'create',
    targetId: newId(),
    payload: { occurredAt: NOW - daysAgo * DAY, flockId, count },
  });
}

beforeEach(async () => {
  await freshStore();
});

describe('money, as an integer', () => {
  /** The reason none of this is a float: 0.1 + 0.2 is not 0.3. */
  it('adds without drifting', () => {
    const cents = [10, 20, 30, 5, 5];
    expect(cents.reduce((a, b) => a + b, 0)).toBe(70);
  });

  it('reads a price back the way it was paid', () => {
    expect(formatMoney(2250, 'USD')).toBe('$22.50');
    expect(formatMoney(2250, 'GBP')).toBe('£22.50');
  });

  /**
   * ¥500 shown as ¥5.00 is a hundredfold error that looks like a formatting
   * slip. Currencies without minor units are handled, not assumed away.
   */
  it('does not invent decimals for a currency that has none', () => {
    expect(minorPer('JPY')).toBe(1);
    expect(formatMoney(500, 'JPY')).toBe('500 JPY');
  });

  it('falls back to the code rather than guessing a symbol', () => {
    expect(formatMoney(4200, 'ZAR')).toBe('42.00 ZAR');
  });

  /**
   * Cost per egg is a few cents, and rounding 3.4 to "$0.03" throws away the
   * precision that makes two seasons comparable — 3.4 against 3.9 is fifteen
   * per cent, and rounding calls them equal.
   */
  it('keeps the precision in a rate too small to be a price', () => {
    expect(formatRate(3.4, 'USD')).toBe('$0.034');
    expect(formatRate(3.9, 'USD')).toBe('$0.039');
  });

  it('shows a rate over a whole unit as ordinary money', () => {
    expect(formatRate(250, 'USD')).toBe('$2.50');
  });
});

describe('what went out on feed', () => {
  it('sums a bucket', async () => {
    await fed(1, 300);
    await fed(2, 200);

    const points = await feedSpend(GROUP, 'week', 12, NOW);
    expect(points[11]?.amount).toBe(500);
  });

  /**
   * A feeding whose price was never known must contribute nothing — not zero,
   * which is a claim that it was free.
   */
  it('leaves an unpriced feeding out rather than counting it as free', async () => {
    await fed(1, 300);
    await fed(1);

    const points = await feedSpend(GROUP, 'week', 12, NOW);
    expect(points[11]?.amount).toBe(300);
  });

  it('leaves out another group’s feed', async () => {
    await fed(1, 300, OTHER);

    const points = await feedSpend(GROUP, 'week', 12, NOW);
    expect(points.every((point) => point.amount === 0)).toBe(true);
  });
});

describe('cost per egg', () => {
  it('divides what was spent by what was collected', async () => {
    await fed(2, 1000);
    await collected(2, 40);

    const per = await feedCostPerEgg(GROUP, 30, NOW);
    expect(per.minorPerEgg).toBe(25);
    expect(per.spent).toBe(1000);
    expect(per.eggs).toBe(40);
  });

  /**
   * The dangerous one. Both halves must come from the SAME window — a month of
   * feed over a year of eggs produces a number with no meaning that looks
   * entirely plausible, which is how it survives to a screen.
   */
  it('counts only the eggs from the window it costed', async () => {
    await fed(2, 1000);
    await collected(2, 40);
    // Last season. Outside the window, and it must not dilute the rate.
    await collected(200, 5000);

    const per = await feedCostPerEgg(GROUP, 30, NOW);
    expect(per.eggs).toBe(40);
    expect(per.minorPerEgg).toBe(25);
  });

  it('counts only the feed from the window it collected over', async () => {
    await fed(2, 1000);
    await fed(200, 90_000);
    await collected(2, 40);

    const per = await feedCostPerEgg(GROUP, 30, NOW);
    expect(per.spent).toBe(1000);
  });

  /**
   * A flock that laid nothing did not produce eggs at zero cost each, and one
   * with no price recorded did not eat free. Both are "cannot say", and saying
   * so is the whole difference between this and a spreadsheet that reports
   * whatever the arithmetic produced.
   */
  it('says nothing rather than dividing by no eggs', async () => {
    await fed(2, 1000);

    const per = await feedCostPerEgg(GROUP, 30, NOW);
    expect(per.minorPerEgg).toBeNull();
  });

  it('says nothing when no feed was ever priced', async () => {
    await fed(2);
    await collected(2, 40);

    const per = await feedCostPerEgg(GROUP, 30, NOW);
    expect(per.minorPerEgg).toBeNull();
    expect(per.costed).toBe(0);
  });

  /**
   * Coverage is reported so the screen can refuse. Half the feedings priced
   * gives half the real cost divided by the full egg count — a figure that
   * reads low and looks right.
   */
  it('reports how much of the feed carried a price', async () => {
    await fed(1, 300);
    await fed(2, 300);
    await fed(3);
    await fed(4);

    const per = await feedCostPerEgg(GROUP, 30, NOW);
    expect(per.feedings).toBe(4);
    expect(per.costed).toBe(2);
  });

  it('leaves out another group’s feed and eggs', async () => {
    await fed(2, 1000, OTHER);
    await collected(2, 40, OTHER);

    const per = await feedCostPerEgg(GROUP, 30, NOW);
    expect(per.spent).toBe(0);
    expect(per.eggs).toBe(0);
    expect(per.minorPerEgg).toBeNull();
  });
});
