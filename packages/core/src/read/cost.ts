import { z } from 'zod';
import { localStore } from '../db/store';
import { bucketsBack, bucketStart, type Grain, type Point } from './trend';

/**
 * What a group costs to keep, against what it gives back.
 *
 * ## The number this exists for
 *
 * Cost per egg. It is the figure a smallholding cannot get from a spreadsheet
 * without an afternoon's work, the one every keeper has an opinion about and no
 * evidence for, and the masterplan names it explicitly as the boundary: far
 * enough to divide spend by production, and no further. There is no account, no
 * balance, no reconciliation. This is not a ledger.
 *
 * ## Feed, and saying so
 *
 * Feed is most of what a laying flock costs — the trade figures put it between
 * sixty and seventy-five per cent — which is why a feed-only cost per egg is
 * worth having. It is also not the whole cost, and a screen that says "3.4¢ an
 * egg" without saying "in feed" has quietly told a farm something false.
 *
 * Everything here is therefore named for what it counts. {@link feedSpend} is
 * feed spend, not spend.
 *
 * ## Silence over a guess
 *
 * A feeding whose cost was never known contributes nothing to the spend AND
 * disqualifies nothing. But a cost per egg computed over a window where half
 * the feedings had no price would divide a half-sized cost by a full-sized
 * production count and report half the true figure — which is worse than
 * refusing, because it looks like an answer.
 *
 * So {@link feedCostPerEgg} reports its own coverage and the screen decides.
 * See `costed` on the result.
 */

const storedFeedLog = z.object({
  occurredAt: z.number().int(),
  flockId: z.string(),
  amountGrams: z.number().int(),
  costCents: z.number().int().nonnegative().optional(),
});

const storedEggLog = z.object({
  occurredAt: z.number().int(),
  flockId: z.string().optional(),
  birdId: z.string().optional(),
  count: z.number().int().nonnegative(),
});

interface Feeding {
  at: number;
  costCents: number | undefined;
}

/**
 * Every feeding for one group, priced where it was priced.
 *
 * Dropping what will not parse rather than throwing, matching `trend.ts` and
 * `history.ts`: one unreadable row written by a newer build must not blank a
 * whole figure.
 */
async function feedings(groupId: string): Promise<Feeding[]> {
  const records = await localStore().readRecordsByEntity('feedLog');

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = storedFeedLog.safeParse(record.value);
      if (!parsed.success || parsed.data.flockId !== groupId) return [];
      return [{ at: parsed.data.occurredAt, costCents: parsed.data.costCents }];
    });
}

async function eggCounts(groupId: string): Promise<{ at: number; count: number }[]> {
  const records = await localStore().readRecordsByEntity('eggLog');

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = storedEggLog.safeParse(record.value);
      if (!parsed.success) return [];
      if ((parsed.data.flockId ?? parsed.data.birdId) !== groupId) return [];
      return [{ at: parsed.data.occurredAt, count: parsed.data.count }];
    });
}

/** What went out on feed, per bucket, in minor units. */
export async function feedSpend(
  groupId: string,
  grain: Grain,
  spans: number,
  now: number = Date.now(),
): Promise<Point[]> {
  const buckets = bucketsBack(spans, grain, now);
  const totals = new Map(buckets.map((at) => [at, 0]));

  for (const feeding of await feedings(groupId)) {
    if (feeding.costCents === undefined) continue;
    const running = totals.get(bucketStart(feeding.at, grain));
    if (running !== undefined) {
      totals.set(bucketStart(feeding.at, grain), running + feeding.costCents);
    }
  }

  return buckets.map((at) => ({ at, amount: totals.get(at) ?? 0 }));
}

export interface PerEgg {
  /** Minor units per egg. Fractional on purpose — this is a rate, not a price. */
  minorPerEgg: number | null;
  /** What was spent on feed over the window, in minor units. */
  spent: number;
  eggs: number;
  /**
   * How many of the window's feedings carried a price, out of how many there
   * were. A rate computed from half the feedings is half a rate, and the screen
   * needs to know that to say so.
   */
  costed: number;
  feedings: number;
}

/**
 * Feed cost per egg over a window of days.
 *
 * Days rather than buckets because the question is "what are they costing me
 * lately", and a calendar month that is four days old is not an answer to it.
 *
 * **Both halves come from the same window.** Dividing a month of feed by a year
 * of eggs, or the reverse, produces a number with no meaning at all — and one
 * that looks entirely plausible, which is how it survives to a screen.
 */
export async function feedCostPerEgg(
  groupId: string,
  days: number,
  now: number = Date.now(),
): Promise<PerEgg> {
  const from = now - days * 86_400_000;

  const inWindow = (await feedings(groupId)).filter(
    (feeding) => feeding.at >= from && feeding.at <= now,
  );
  const spent = inWindow.reduce((sum, feeding) => sum + (feeding.costCents ?? 0), 0);
  const costed = inWindow.filter((feeding) => feeding.costCents !== undefined).length;

  const eggs = (await eggCounts(groupId))
    .filter((entry) => entry.at >= from && entry.at <= now)
    .reduce((sum, entry) => sum + entry.count, 0);

  return {
    // No eggs is not a cost of zero per egg, and no spend recorded is not a
    // flock that ate free. Both are "cannot say".
    minorPerEgg: eggs > 0 && spent > 0 ? spent / eggs : null,
    spent,
    eggs,
    costed,
    feedings: inWindow.length,
  };
}
