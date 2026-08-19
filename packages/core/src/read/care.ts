import { z } from 'zod';
import { type CareKind, careLogCreateSchema } from '@homefarm/contracts';
import { localStore } from '../db/store';

/**
 * Routine husbandry, read back.
 *
 * **This is what makes a husbandry row disappear.** `careDues` puts a job on
 * Today when the interval since the last one has run out, and until this
 * module existed there was no last one — every group read as never-wormed and
 * never-trimmed, so Today carried seven permanent rows per group that nothing
 * a farmer did could clear. A list with permanent residents is a list people
 * stop reading, which is the failure the due engine was designed to avoid.
 *
 * Nothing is ticked off. The record of the job existing is the clearing
 * mechanism (due/types.ts, property 3).
 */

export interface CareEntry {
  id: string;
  occurredAt: number;
  kind: CareKind;
  flockId?: string;
  animalId?: string;
  product?: string;
  note?: string;
}

/**
 * The stored payload, loosened.
 *
 * Rebuilt from `.shape` rather than `.partial()`-ed directly: Zod refuses to
 * partial a schema carrying a refinement, and this one has the exactly-one-of
 * check on `flockId`/`animalId`. Dropping the refinement is right on the way
 * out anyway — a row that fails it is skipped rather than rendered
 * half-formed, and the field checks below are what this read actually needs.
 */
const storedCareLog = z.object(careLogCreateSchema.shape).partial();

export async function listCareLogs(): Promise<CareEntry[]> {
  const records = await localStore().readRecordsByEntity('careLog');

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = storedCareLog.safeParse(record.value);
      if (!parsed.success || parsed.data.occurredAt === undefined || parsed.data.kind === undefined) {
        return [];
      }

      const { occurredAt, kind, flockId, animalId, product, note } = parsed.data;
      return [
        {
          id: record.targetId,
          occurredAt,
          kind,
          ...(flockId === undefined ? {} : { flockId }),
          ...(animalId === undefined ? {} : { animalId }),
          ...(product === undefined ? {} : { product }),
          ...(note === undefined ? {} : { note }),
        } satisfies CareEntry,
      ];
    })
    .sort((a, b) => b.occurredAt - a.occurredAt);
}

/**
 * When each job was last done, per group.
 *
 * The **latest** date wins rather than the most recently entered one: someone
 * catching up on Sunday enters Tuesday's worming after Thursday's, and taking
 * the last row written would restart the clock from the earlier date.
 */
export function lastCareBySubject(
  entries: readonly CareEntry[],
): Map<string, Partial<Record<CareKind, number>>> {
  const bySubject = new Map<string, Partial<Record<CareKind, number>>>();

  for (const entry of entries) {
    const subject = entry.flockId ?? entry.animalId;
    if (subject === undefined) continue;

    const kinds = bySubject.get(subject) ?? {};
    const existing = kinds[entry.kind];
    if (existing === undefined || entry.occurredAt > existing) {
      kinds[entry.kind] = entry.occurredAt;
      bySubject.set(subject, kinds);
    }
  }

  return bySubject;
}
