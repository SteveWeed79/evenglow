import { z } from 'zod';
import {
  activeWithdrawals,
  type ActiveWithdrawal,
  MEDICATION_ROUTES,
  type TreatmentRecord,
  WITHDRAWAL_KINDS,
  type WithdrawalKind,
} from '@homefarm/contracts';
import { localStore } from '../db/store';

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
  /**
   * Read but not used by the withdrawal engine.
   *
   * `TreatmentRecord` is deliberately the minimum `activeWithdrawals` needs to
   * do arithmetic, and it stays that way — widening a domain contract so a
   * form can prefill itself is how an engine ends up carrying fields it never
   * consults. These are parsed here and exposed as `TreatmentDetail`.
   */
  reason: z.string().optional(),
  route: z.enum(MEDICATION_ROUTES).optional(),
  dose: z.string().optional(),
  note: z.string().optional(),
});

/** A treatment as the form that edits it needs — the whole stored record. */
export type TreatmentDetail = TreatmentRecord & z.infer<typeof storedMedication>;

/**
 * A treatment as a screen needs it — the record, plus the two things a person
 * standing in front of it wants to know.
 *
 * `running` is the one that matters, and it errs in the dangerous direction.
 * A withdrawal is counted from the last day of treatment, and `withdrawalClearsAt`
 * takes `Math.max(administeredAt, treatmentEndsAt ?? 0)` — so a course with no
 * end date is counted from the **first** dose. A five-day course with a
 * seven-day egg withdrawal, left open, says the eggs are clear on day eight
 * when the true date is day twelve.
 *
 * That is the error this app is written to never make, and until it could be
 * closed there was no way to correct it: the record is unreachable once
 * written. So an open course is not a tidiness problem, it is an
 * under-estimated withdrawal, and the screens say so.
 */
export interface Treatment extends TreatmentDetail {
  /**
   * No end date recorded, so the withdrawal is counted from the first dose and
   * is short by however long the course actually ran.
   */
  running: boolean;
  /** Open withdrawals right now, by produce kind. Empty when nothing is held. */
  holding: WithdrawalKind[];
}

/**
 * Every treatment recorded against one group or animal, newest first.
 *
 * Archived records are filtered like everywhere else, so a treatment taken
 * back stops holding the produce it was holding.
 */
export async function treatmentsFor(
  subjectId: string,
  now: number = Date.now(),
): Promise<Treatment[]> {
  const treatments = (await listTreatments()).filter(
    (t) => t.flockId === subjectId || t.animalId === subjectId,
  );

  const holdingByTreatment = new Map<string, WithdrawalKind[]>();
  for (const kind of WITHDRAWAL_KINDS) {
    for (const open of activeWithdrawals(treatments, kind, [subjectId], now)) {
      holdingByTreatment.set(open.medicationId, [
        ...(holdingByTreatment.get(open.medicationId) ?? []),
        kind,
      ]);
    }
  }

  return treatments
    .map((treatment) => ({
      ...treatment,
      running: treatment.treatmentEndsAt === undefined,
      holding: holdingByTreatment.get(treatment.id) ?? [],
    }))
    .sort((a, b) => b.administeredAt - a.administeredAt);
}

/** One treatment, for the screen that edits it. Null when it is gone. */
export async function treatmentById(id: string): Promise<TreatmentDetail | null> {
  return (await listTreatments()).find((treatment) => treatment.id === id) ?? null;
}

async function listTreatments(): Promise<TreatmentDetail[]> {
  const records = await localStore().readRecordsByEntity('medication');

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = storedMedication.safeParse(record.value);
      if (!parsed.success) return [];

      return [{ id: record.targetId, ...parsed.data } satisfies TreatmentDetail];
    });
}

/** Every open withdrawal of one kind, keyed by the group or animal it covers. */
export async function withdrawalsBySubject(
  kind: WithdrawalKind,
  subjectIds: readonly string[],
  now: number = Date.now(),
): Promise<Map<string, ActiveWithdrawal[]>> {
  return gather(await listTreatments(), [kind], subjectIds, now);
}

/**
 * Every open withdrawal of **every** kind, keyed the same way.
 *
 * One read of the treatments rather than one per kind, for the two callers
 * that need the lot: Today's tallies and the group screen's bands. Both used
 * to ask for `'egg'` alone — `useGroups` records what that cost a dairy herd
 * — and a reader that answers the whole question is what stops the third
 * caller making the same choice. Each entry carries its `kind`, so
 * `withdrawalsFor` and `longestPerKind` split the list back up where it is
 * shown.
 */
export async function allWithdrawalsBySubject(
  subjectIds: readonly string[],
  now: number = Date.now(),
): Promise<Map<string, ActiveWithdrawal[]>> {
  return gather(await listTreatments(), WITHDRAWAL_KINDS, subjectIds, now);
}

function gather(
  treatments: readonly TreatmentRecord[],
  kinds: readonly WithdrawalKind[],
  subjectIds: readonly string[],
  now: number,
): Map<string, ActiveWithdrawal[]> {
  const bySubject = new Map<string, ActiveWithdrawal[]>();
  for (const kind of kinds) {
    for (const withdrawal of activeWithdrawals(treatments, kind, subjectIds, now)) {
      const existing = bySubject.get(withdrawal.subjectId) ?? [];
      existing.push(withdrawal);
      bySubject.set(withdrawal.subjectId, existing);
    }
  }

  return bySubject;
}
