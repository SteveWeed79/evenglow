import { z } from 'zod';
import {
  type CareIntervals,
  feedPlanCreateSchema,
  flockCreateSchema,
  idMintedAt,
  type Species,
} from '@steading/contracts';
import { localStore } from '../db/store';

/**
 * Local-first reads.
 *
 * Today must render from IndexedDB, not from the network (R1, R6). These read
 * the optimistic projection the queue writes, so a group created in the yard
 * with no signal is visible immediately and survives a restart.
 *
 * The server remains the source of truth; a device that has never synced sees
 * only what it recorded itself, which is the correct answer for that device.
 */

export interface Group {
  id: string;
  name: string;
  species: Species;
  speciesOther?: string;
  breed?: string;
  count: number;
  /**
   * What the grow-out clock needs, and why it is read here rather than
   * fetched separately: the clock refuses to guess any of them, so a screen
   * that has the group already has everything the answer depends on.
   */
  breedId?: string;
  purposes?: string[];
  /** Hatched or born. NOT when they were acquired — see due/growout.ts. */
  bornAt?: number;
  /** The farm's own processing figure, in weeks. Beats the library. */
  processAtWeeks?: number;
  /**
   * The farm's own intervals for the routine jobs. `null` silences one.
   * Absent, or a kind absent from it, means the species default applies.
   */
  careIntervals?: CareIntervals;
  /**
   * When this farm added the group, decoded from the ULID in its id.
   *
   * No stored field and no migration: a ULID's first 48 bits are the moment it
   * was minted. `LocalRecord` carries only `updatedAt`, which moves on every
   * edit and cannot answer "how long has this farm had this".
   */
  since?: number;
}

/** The projection stores whatever the payload held, so it is parsed on the way out. */
const storedGroup = flockCreateSchema.partial({ count: true });

export async function listGroups(): Promise<Group[]> {
  const records = await localStore().readRecordsByEntity('flock');

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = storedGroup.safeParse(record.value);
      // A record that no longer matches the contract is skipped rather than
      // rendered half-formed; the diagnostics sheet reports the discrepancy.
      if (!parsed.success) return [];

      const mintedAt = idMintedAt(record.targetId);

      return [
        {
          id: record.targetId,
          name: parsed.data.name,
          species: parsed.data.species,
          ...(parsed.data.speciesOther === undefined
            ? {}
            : { speciesOther: parsed.data.speciesOther }),
          ...(parsed.data.breed === undefined ? {} : { breed: parsed.data.breed }),
          ...(parsed.data.breedId === undefined ? {} : { breedId: parsed.data.breedId }),
          ...(parsed.data.purposes === undefined ? {} : { purposes: [...parsed.data.purposes] }),
          ...(parsed.data.bornAt === undefined ? {} : { bornAt: parsed.data.bornAt }),
          ...(parsed.data.processAtWeeks === undefined
            ? {}
            : { processAtWeeks: parsed.data.processAtWeeks }),
          ...(parsed.data.careIntervals === undefined
            ? {}
            : { careIntervals: parsed.data.careIntervals }),
          ...(mintedAt === null ? {} : { since: mintedAt }),
          count: parsed.data.count ?? 0,
        } satisfies Group,
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const storedEggLog = z.object({
  occurredAt: z.number().int(),
  flockId: z.string().optional(),
  birdId: z.string().optional(),
  count: z.number().int().nonnegative(),
});

/**
 * Eggs logged today, per group.
 *
 * Counted from the local projection, so the number on screen is what this
 * device recorded — including work still sitting in the queue. A tally that
 * only counted synced records would drop to zero the moment the signal did.
 */
export async function eggsToday(now = new Date()): Promise<Map<string, number>> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const from = start.getTime();

  const records = await localStore().readRecordsByEntity('eggLog');
  const totals = new Map<string, number>();

  for (const record of records) {
    if (record.deleted) continue;

    const parsed = storedEggLog.safeParse(record.value);
    if (!parsed.success) continue;
    if (parsed.data.occurredAt < from) continue;

    const subject = parsed.data.flockId ?? parsed.data.birdId;
    if (subject === undefined) continue;

    totals.set(subject, (totals.get(subject) ?? 0) + parsed.data.count);
  }

  return totals;
}

// ── the other observations a group produces ──────────────────────────────────

const storedProductionLog = z.object({
  occurredAt: z.number().int(),
  flockId: z.string().optional(),
  animalId: z.string().optional(),
  kind: z.string(),
  amount: z.number().int(),
  unit: z.string(),
  label: z.string().optional(),
});

export interface Produce {
  /** Millilitres for milk, grams for fibre and honey. */
  amount: number;
  unit: string;
  kind: string;
}

/**
 * Non-egg produce taken today, per group.
 *
 * Milk, fibre and honey rather than head count and mortality — without this,
 * ruminant support is a list of animals that die. Keyed `${subject}:${kind}`
 * because a farm milking goats and shearing them takes both off the same
 * group and summing them would be nonsense in two units at once.
 */
export async function produceToday(now = new Date()): Promise<Map<string, Produce>> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const from = start.getTime();

  const records = await localStore().readRecordsByEntity('productionLog');
  const totals = new Map<string, Produce>();

  for (const record of records) {
    if (record.deleted) continue;

    const parsed = storedProductionLog.safeParse(record.value);
    if (!parsed.success || parsed.data.occurredAt < from) continue;

    const subject = parsed.data.flockId ?? parsed.data.animalId;
    if (subject === undefined) continue;

    const key = `${subject}:${parsed.data.kind}`;
    const existing = totals.get(key);
    totals.set(key, {
      kind: parsed.data.kind,
      unit: parsed.data.unit,
      amount: (existing?.amount ?? 0) + parsed.data.amount,
    });
  }

  return totals;
}

const storedMortality = z.object({
  occurredAt: z.number().int(),
  flockId: z.string(),
  count: z.number().int(),
  cause: z.string(),
});

/**
 * Losses per group, ever.
 *
 * Deliberately not netted off the head count. A group's `count` is what the
 * keeper says is there, and quietly decrementing it from mortality rows would
 * mean two sources of truth for the same number disagreeing the first time
 * somebody also edited the group by hand.
 */
export async function lossesByGroup(): Promise<Map<string, number>> {
  const records = await localStore().readRecordsByEntity('mortality');
  const totals = new Map<string, number>();

  for (const record of records) {
    if (record.deleted) continue;
    const parsed = storedMortality.safeParse(record.value);
    if (!parsed.success) continue;

    totals.set(parsed.data.flockId, (totals.get(parsed.data.flockId) ?? 0) + parsed.data.count);
  }

  return totals;
}

const storedFeedLog = z.object({
  occurredAt: z.number().int(),
  flockId: z.string(),
  amountGrams: z.number().int(),
  feedType: z.string().optional(),
});

const storedShearing = z.object({
  occurredAt: z.number().int(),
  flockId: z.string().optional(),
  animalId: z.string().optional(),
});

/**
 * When each group was last shorn, which is what the shearing due counts from.
 *
 * A clip on a named animal counts for its group as well. A farm with four
 * alpacas, two of them named, shears all four on the same afternoon and
 * records what it recorded — and a due row that ignored the named ones would
 * tell that farm it had never shorn anything.
 */
export async function lastShornByGroup(
  animals: ReadonlyMap<string, string>,
): Promise<Map<string, number>> {
  const records = await localStore().readRecordsByEntity('shearing');
  const latest = new Map<string, number>();

  for (const record of records) {
    if (record.deleted) continue;
    const parsed = storedShearing.safeParse(record.value);
    if (!parsed.success) continue;

    const groupId =
      parsed.data.flockId ??
      (parsed.data.animalId === undefined ? undefined : animals.get(parsed.data.animalId));
    if (groupId === undefined) continue;

    const seen = latest.get(groupId);
    if (seen === undefined || parsed.data.occurredAt > seen) {
      latest.set(groupId, parsed.data.occurredAt);
    }
  }

  return latest;
}

/** When each group was last fed, so a screen can say "fed this morning". */
/** When a group was last fed, and what they were given. */
export interface LastFed {
  at: number;
  /**
   * What the sack was called, when the record says.
   *
   * Optional in the schema and often absent — a feed can be logged with the
   * text field left empty, and every record written before the shelf existed
   * has nothing here.
   */
  feedType?: string;
}

/**
 * The last feed for each group.
 *
 * **`feedType` has been on the record since the schema was written and this
 * threw it away**, returning a bare timestamp. So the feed screen could say
 * *"Last fed Monday, August 10"* and not which sack — while sorting a shelf of
 * chips it had no memory of.
 *
 * That matters most on a big shelf. A farm feeds the same thing every day, so
 * what a group had last time is the strongest guess available about what they
 * are about to get, stronger than which species the sack is labelled for. It
 * costs nothing to keep: the record was already parsed and the field already
 * read past.
 */
export async function lastFedByGroup(): Promise<Map<string, LastFed>> {
  const records = await localStore().readRecordsByEntity('feedLog');
  const latest = new Map<string, LastFed>();

  for (const record of records) {
    if (record.deleted) continue;
    const parsed = storedFeedLog.safeParse(record.value);
    if (!parsed.success) continue;

    const seen = latest.get(parsed.data.flockId);
    if (seen === undefined || parsed.data.occurredAt > seen.at) {
      latest.set(parsed.data.flockId, {
        at: parsed.data.occurredAt,
        ...(parsed.data.feedType === undefined ? {} : { feedType: parsed.data.feedType }),
      });
    }
  }

  return latest;
}

// ── feed plans ───────────────────────────────────────────────────────────────

/**
 * What a group *should* be fed, as distinct from what it was.
 *
 * `feedLog` records the second and has since the first schema; this is the
 * first half — and without it `feedNeededUg` has been arithmetic with nothing
 * to work on since the day it was written. A farm with no plan gets null
 * rather than an estimate built on a guess about how much a goat eats.
 */
export interface FeedPlan {
  id: string;
  flockId: string;
  feedName: string;
  /** Per animal per day. Multiplied by head count to predict the bag. */
  perAnimalPerDayUg: number;
  startedAt: number;
  /** Absent means current. Set when the ration is superseded. */
  endedAt?: number;
  note?: string;
}

const storedFeedPlan = z.object(feedPlanCreateSchema.shape).partial();

/**
 * The ration in force for each group, newest first.
 *
 * **Superseding rather than editing** is how a ration changes: a plan ends and
 * another begins, so a cost read over last spring uses last spring's ration
 * rather than today's. That is the same reason `feedLog` stamps its own cost
 * at log time — a season's history rewritten by a price change is history the
 * farm cannot check.
 *
 * A group with several plans open is a farm mid-change rather than a defect,
 * so this takes the one that started most recently rather than refusing.
 */
export async function currentFeedPlans(): Promise<Map<string, FeedPlan>> {
  const records = await localStore().readRecordsByEntity('feedPlan');

  const live = records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = storedFeedPlan.safeParse(record.value);
      if (
        !parsed.success ||
        parsed.data.flockId === undefined ||
        parsed.data.feedName === undefined ||
        parsed.data.perAnimalPerDayUg === undefined ||
        parsed.data.startedAt === undefined
      ) {
        return [];
      }

      const { flockId, feedName, perAnimalPerDayUg, startedAt, endedAt, note } = parsed.data;
      // Ended plans are history, not the ration. They stay on disk because
      // nothing here deletes a record, and they are simply not in force.
      if (endedAt !== undefined) return [];

      return [
        {
          id: record.targetId,
          flockId,
          feedName,
          perAnimalPerDayUg,
          startedAt,
          ...(note === undefined ? {} : { note }),
        } satisfies FeedPlan,
      ];
    })
    .sort((a, b) => b.startedAt - a.startedAt);

  const byGroup = new Map<string, FeedPlan>();
  for (const plan of live) if (!byGroup.has(plan.flockId)) byGroup.set(plan.flockId, plan);
  return byGroup;
}
