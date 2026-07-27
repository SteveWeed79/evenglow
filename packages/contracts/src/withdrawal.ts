import type { WithdrawalKind } from './contracts/entities';

/**
 * Withdrawal-period arithmetic (W2).
 *
 * Pure on purpose: whether it is safe to sell today's eggs is a compliance
 * question, and compliance logic that can only be checked through a database
 * and a browser does not get checked.
 *
 * Deliberately conservative at every boundary. The cost of a false warning is
 * one confirm tap; the cost of a missed one is selling produce inside a
 * withdrawal window.
 */

const DAY_MS = 86_400_000;

/** The fields this module needs. Anything richer is the caller's business. */
export interface TreatmentRecord {
  id: string;
  name: string;
  flockId?: string | undefined;
  animalId?: string | undefined;
  administeredAt: number;
  treatmentEndsAt?: number | undefined;
  withdrawalDays?:
    | {
        egg?: number | undefined;
        meat?: number | undefined;
        milk?: number | undefined;
      }
    | undefined;
}

export interface ActiveWithdrawal {
  kind: WithdrawalKind;
  medicationId: string;
  medication: string;
  subjectId: string;
  /** Milliseconds. The first moment produce is clear again. */
  clearsAt: number;
}

/**
 * When a treatment's withdrawal ends for one produce kind.
 *
 * Counted from the last day of treatment, not the first dose — a five-day
 * course with a seven-day egg withdrawal clears twelve days after it started,
 * not seven. Getting this backwards is the classic way to sell too early.
 *
 * Returns null when the medication imposes no withdrawal on this kind; a
 * topical wound spray does not stop egg sales.
 */
export function withdrawalClearsAt(
  treatment: TreatmentRecord,
  kind: WithdrawalKind,
): number | null {
  const days = treatment.withdrawalDays?.[kind];
  if (days === undefined) return null;

  // A treatment recorded as ending before it began is bad data; take the later
  // of the two so the window can only ever be longer than the truth.
  const lastDose = Math.max(treatment.administeredAt, treatment.treatmentEndsAt ?? 0);

  return lastDose + days * DAY_MS;
}

/**
 * Every withdrawal still in force at `now`, most recently clearing last.
 *
 * A treatment on the group covers every animal in it; a treatment on one
 * animal covers only that animal. `subjectIds` is the set the caller cares
 * about — typically a group id and, when logging per-animal, that animal's id.
 */
export function activeWithdrawals(
  treatments: readonly TreatmentRecord[],
  kind: WithdrawalKind,
  subjectIds: readonly string[],
  now: number = Date.now(),
): ActiveWithdrawal[] {
  const wanted = new Set(subjectIds);
  const active: ActiveWithdrawal[] = [];

  for (const treatment of treatments) {
    const subjectId = treatment.flockId ?? treatment.animalId;
    if (subjectId === undefined || !wanted.has(subjectId)) continue;

    const clearsAt = withdrawalClearsAt(treatment, kind);
    if (clearsAt === null) continue;

    // Strictly greater: at the instant it clears, it is clear.
    if (clearsAt > now) {
      active.push({
        kind,
        medicationId: treatment.id,
        medication: treatment.name,
        subjectId,
        clearsAt,
      });
    }
  }

  return active.sort((a, b) => a.clearsAt - b.clearsAt);
}

/** The one that matters — the last to clear. */
export function longestWithdrawal(active: readonly ActiveWithdrawal[]): ActiveWithdrawal | null {
  return active.length === 0 ? null : (active[active.length - 1] ?? null);
}

/**
 * Whole days remaining, rounded up. "Clear in 1 day" while any part of a day
 * remains is the honest reading; rounding down would say "clear today" during
 * a window that has hours left.
 */
export function daysUntilClear(clearsAt: number, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((clearsAt - now) / DAY_MS));
}

/** Plain and specific — it names the medication and the date (UX-SPEC §6). */
export function withdrawalMessage(active: ActiveWithdrawal, now: number = Date.now()): string {
  const days = daysUntilClear(active.clearsAt, now);
  const when = new Date(active.clearsAt).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const noun = active.kind === 'egg' ? 'Eggs' : active.kind === 'milk' ? 'Milk' : 'Meat';

  return `${noun} withheld — ${active.medication}. Clear ${when} (${days} ${days === 1 ? 'day' : 'days'}).`;
}
