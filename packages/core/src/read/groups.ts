import { z } from 'zod';
import { flockCreateSchema, type Species } from '@steading/contracts';
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

/** When each group was last fed, so a screen can say "fed this morning". */
export async function lastFedByGroup(): Promise<Map<string, number>> {
  const records = await localStore().readRecordsByEntity('feedLog');
  const latest = new Map<string, number>();

  for (const record of records) {
    if (record.deleted) continue;
    const parsed = storedFeedLog.safeParse(record.value);
    if (!parsed.success) continue;

    const seen = latest.get(parsed.data.flockId);
    if (seen === undefined || parsed.data.occurredAt > seen) {
      latest.set(parsed.data.flockId, parsed.data.occurredAt);
    }
  }

  return latest;
}
