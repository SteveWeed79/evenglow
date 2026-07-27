import { z } from 'zod';
import type { WithdrawalKind } from '@/lib/contracts/entities';
import { activeWithdrawals, type ActiveWithdrawal, type TreatmentRecord } from '@/lib/withdrawal';
import { readRecordsByEntity } from '../db/open';

/**
 * Reads treatments from the local projection so the withdrawal banner works
 * offline. A compliance warning that needs signal is a compliance warning that
 * is absent in a barn.
 */

const storedMedication = z.object({
  name: z.string(),
  flockId: z.string().optional(),
  animalId: z.string().optional(),
  administeredAt: z.number().int(),
  treatmentEndsAt: z.number().int().optional(),
  withdrawalDays: z
    .object({
      egg: z.number().int().optional(),
      meat: z.number().int().optional(),
      milk: z.number().int().optional(),
    })
    .optional(),
});

export async function listTreatments(): Promise<TreatmentRecord[]> {
  const records = await readRecordsByEntity('medication');

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = storedMedication.safeParse(record.value);
      if (!parsed.success) return [];

      return [{ id: record.targetId, ...parsed.data } satisfies TreatmentRecord];
    });
}

/** Every open withdrawal of one kind, keyed by the group or animal it covers. */
export async function withdrawalsBySubject(
  kind: WithdrawalKind,
  subjectIds: readonly string[],
  now: number = Date.now(),
): Promise<Map<string, ActiveWithdrawal[]>> {
  const treatments = await listTreatments();
  const active = activeWithdrawals(treatments, kind, subjectIds, now);

  const bySubject = new Map<string, ActiveWithdrawal[]>();
  for (const withdrawal of active) {
    const existing = bySubject.get(withdrawal.subjectId) ?? [];
    existing.push(withdrawal);
    bySubject.set(withdrawal.subjectId, existing);
  }

  return bySubject;
}
