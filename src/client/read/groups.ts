import { z } from 'zod';
import { flockCreateSchema, type Species } from '@/lib/contracts/entities';
import { readAllRecords } from '../db/open';

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
}

/** The projection stores whatever the payload held, so it is parsed on the way out. */
const storedGroup = flockCreateSchema.partial({ count: true });

export async function listGroups(): Promise<Group[]> {
  const records = await readAllRecords();

  return records
    .filter((record) => record.entity === 'flock' && !record.deleted)
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

  const records = await readAllRecords();
  const totals = new Map<string, number>();

  for (const record of records) {
    if (record.entity !== 'eggLog' || record.deleted) continue;

    const parsed = storedEggLog.safeParse(record.value);
    if (!parsed.success) continue;
    if (parsed.data.occurredAt < from) continue;

    const subject = parsed.data.flockId ?? parsed.data.birdId;
    if (subject === undefined) continue;

    totals.set(subject, (totals.get(subject) ?? 0) + parsed.data.count);
  }

  return totals;
}
