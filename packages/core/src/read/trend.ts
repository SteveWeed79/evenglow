import { z } from 'zod';
import { localStore } from '../db/store';

/**
 * What a group has produced over time, bucketed.
 *
 * ## Why this is a read and not a stored rollup
 *
 * The same argument `history.ts` makes: everything is already on the device as
 * append-only records, and a stored total is a second copy of what happened
 * that can disagree with the first. A season of egg logs is a few thousand
 * rows — the bench figure for a busy year is 1,540 records at 884 KB — and
 * summing them is arithmetic a phone does not notice.
 *
 * ## Buckets, not points
 *
 * A chart of raw log entries is noise: a farm that collects twice on Saturday
 * and forgets Sunday has not changed its lay rate, and a line drawn through
 * those two points says it has. Bucketing by week is what makes a trend a
 * trend — and weeks rather than days because the question a farm asks is "are
 * they slowing down", which is a question about a month.
 *
 * **Empty buckets are kept.** A week with no eggs is a real answer and dropping
 * it would draw a chart that skips the fortnight nobody collected — which is
 * exactly the fortnight worth seeing.
 */

export type Grain = 'week' | 'month';

export interface Point {
  /** The start of the bucket, local. Its label and its key. */
  at: number;
  amount: number;
}

const DAY = 86_400_000;

/** The start of the bucket a moment falls in. Weeks start on Monday. */
export function bucketStart(at: number, grain: Grain): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);

  if (grain === 'month') {
    date.setDate(1);
    return date.getTime();
  }

  // getDay() is 0 for Sunday; a farm's week starts on Monday, so Sunday is 6
  // days after the start rather than the day before it.
  const weekday = (date.getDay() + 6) % 7;
  return date.getTime() - weekday * DAY;
}

/** The bucket after this one, which is how a range is walked. */
function nextBucket(at: number, grain: Grain): number {
  if (grain === 'week') return at + 7 * DAY;
  const date = new Date(at);
  date.setMonth(date.getMonth() + 1);
  return date.getTime();
}

/**
 * The last `spans` buckets, oldest first, with every one present.
 *
 * Built by walking back from now rather than from the earliest record, so a
 * chart is always the same width — a farm with three weeks of data and one
 * with three years both get twelve columns, and the empty ones say so.
 */
export function bucketsBack(spans: number, grain: Grain, now: number): number[] {
  const out: number[] = [bucketStart(now, grain)];

  while (out.length < spans) {
    const oldest = out[0];
    if (oldest === undefined) break;

    const date = new Date(oldest);
    if (grain === 'week') out.unshift(oldest - 7 * DAY);
    else {
      date.setMonth(date.getMonth() - 1);
      out.unshift(date.getTime());
    }
  }

  return out;
}

/** Sums dated amounts into the buckets they fall in. */
function into(
  spans: number,
  grain: Grain,
  now: number,
  entries: readonly { at: number; amount: number }[],
): Point[] {
  const buckets = bucketsBack(spans, grain, now);
  const totals = new Map(buckets.map((at) => [at, 0]));
  const first = buckets[0] ?? 0;
  const last = nextBucket(buckets[buckets.length - 1] ?? 0, grain);

  for (const entry of entries) {
    // Outside the window entirely. Checked before bucketing so a farm with
    // three years of records does not build three years of keys.
    if (entry.at < first || entry.at >= last) continue;

    const key = bucketStart(entry.at, grain);
    const running = totals.get(key);
    if (running !== undefined) totals.set(key, running + entry.amount);
  }

  return buckets.map((at) => ({ at, amount: totals.get(at) ?? 0 }));
}

const storedEggLog = z.object({
  occurredAt: z.number().int(),
  flockId: z.string().optional(),
  birdId: z.string().optional(),
  count: z.number().int().nonnegative(),
});

const storedProductionLog = z.object({
  occurredAt: z.number().int(),
  flockId: z.string().optional(),
  animalId: z.string().optional(),
  kind: z.string(),
  amount: z.number().int(),
});

const storedFeedLog = z.object({
  occurredAt: z.number().int(),
  flockId: z.string(),
  amountGrams: z.number().int(),
});

/**
 * Reads one entity into dated amounts, dropping what will not parse.
 *
 * Dropping rather than throwing, for `history.ts`'s reason: one unreadable row
 * — written by a newer build, half-migrated — must not blank a whole chart.
 */
async function amounts<T>(
  entity: string,
  schema: z.ZodType<T>,
  pick: (value: T) => { at: number; amount: number } | null,
): Promise<{ at: number; amount: number }[]> {
  const records = await localStore().readRecordsByEntity(entity);

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = schema.safeParse(record.value);
      if (!parsed.success) return [];
      const taken = pick(parsed.data);
      return taken === null ? [] : [taken];
    });
}

/** Eggs from one group, per bucket. */
export async function eggTrend(
  groupId: string,
  grain: Grain,
  spans: number,
  now: number = Date.now(),
): Promise<Point[]> {
  const entries = await amounts('eggLog', storedEggLog, (v) =>
    (v.flockId ?? v.birdId) === groupId ? { at: v.occurredAt, amount: v.count } : null,
  );
  return into(spans, grain, now, entries);
}

/** One kind of produce — milk, fibre, honey — from one group, per bucket. */
export async function produceTrend(
  groupId: string,
  kind: string,
  grain: Grain,
  spans: number,
  now: number = Date.now(),
): Promise<Point[]> {
  const entries = await amounts('productionLog', storedProductionLog, (v) =>
    (v.flockId ?? v.animalId) === groupId && v.kind === kind
      ? { at: v.occurredAt, amount: v.amount }
      : null,
  );
  return into(spans, grain, now, entries);
}

/** Feed into one group, per bucket, in grams. */
export async function feedTrend(
  groupId: string,
  grain: Grain,
  spans: number,
  now: number = Date.now(),
): Promise<Point[]> {
  const entries = await amounts('feedLog', storedFeedLog, (v) =>
    v.flockId === groupId ? { at: v.occurredAt, amount: v.amountGrams } : null,
  );
  return into(spans, grain, now, entries);
}

/**
 * What the chart is worth saying in words.
 *
 * A shape tells a farm something is happening; a sentence tells them what. And
 * on a phone read at arm's length in a yard, the sentence is the part that
 * survives — which is why this is in the projection rather than left to a
 * screen to work out from pixels.
 *
 * Compares the most recent COMPLETE bucket with the one before it. The current
 * week is always low simply because it is not finished, and a chart that
 * announced a collapse every Monday morning would be one nobody trusted by the
 * second week.
 */
export interface Direction {
  /** Positive is up. Null when there is not enough to compare. */
  changePercent: number | null;
  /** The complete bucket the comparison is about. */
  latest: Point | null;
  previous: Point | null;
}

export function direction(points: readonly Point[]): Direction {
  // The last entry is the bucket in progress, so the comparison starts one
  // back. Fewer than three buckets is not a trend, it is two numbers.
  const latest = points[points.length - 2] ?? null;
  const previous = points[points.length - 3] ?? null;

  if (latest === null || previous === null || previous.amount === 0) {
    return { changePercent: null, latest, previous };
  }

  return {
    changePercent: Math.round(((latest.amount - previous.amount) / previous.amount) * 100),
    latest,
    previous,
  };
}
