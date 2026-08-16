import type { WithdrawalKind } from './entities';

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
  /**
   * Milliseconds — the first moment produce is clear again — or **null while
   * the course is still running**, which means "not until somebody closes it".
   *
   * Nullable rather than a far-future number, because every consumer has to
   * make a decision here and a sentinel lets one of them forget. A date
   * arithmetic can reach is a date a screen will print.
   */
  clearsAt: number | null;
}

/**
 * What a treatment's withdrawal is doing for one produce kind, in the three
 * states it can actually be in.
 *
 * The third one is why this is a union and not a date. A course with no end
 * date recorded is not a course that ended on its first day — it is a course
 * whose end nobody has stated yet, and the two are opposite answers to "is
 * this produce safe".
 */
export type WithdrawalWindow =
  /** This medication imposes no withdrawal on this kind — a wound spray does not stop egg sales. */
  | { state: 'none' }
  /** Still being dosed. Nothing clears until a last dose is recorded. */
  | { state: 'open' }
  /** Clear from this instant. */
  | { state: 'clears'; at: number };

/**
 * When a treatment's withdrawal ends for one produce kind.
 *
 * Counted from the last day of treatment, not the first dose — a five-day
 * course with a seven-day egg withdrawal clears twelve days after it started,
 * not seven. Getting this backwards is the classic way to sell too early.
 *
 * ## Why an open course holds instead of clearing
 *
 * This function used to answer with a date whether or not the course had
 * ended, counting from `administeredAt` when there was no `treatmentEndsAt`.
 * That is the same arithmetic as a single dose given that day, and it is wrong
 * in the one direction this module exists to never be wrong in: a ten-day
 * course logged on day one said the eggs were clear on day eight, while the
 * bird was still being dosed.
 *
 * The defect was known — `read/withdrawals.ts` described it in full and the
 * screens carried a warning about it — and the produce cleared anyway. A
 * warning is not a hold.
 *
 * **Holding indefinitely is safe here only because the entry screen defaults
 * to closed.** `TreatmentScreen` initialises "the course is still running" to
 * false, so an ordinary single dose records an end date and clears normally;
 * the only records that hold forever are the ones somebody deliberately marked
 * as running, which is exactly the set that should. If that default is ever
 * flipped, this becomes a banner nobody can clear, and the two facts have to
 * move together.
 */
export function withdrawalWindow(
  treatment: TreatmentRecord,
  kind: WithdrawalKind,
): WithdrawalWindow {
  const days = treatment.withdrawalDays?.[kind];
  if (days === undefined) return { state: 'none' };

  if (treatment.treatmentEndsAt === undefined) return { state: 'open' };

  // A treatment recorded as ending before it began is bad data; take the later
  // of the two so the window can only ever be longer than the truth.
  const lastDose = Math.max(treatment.administeredAt, treatment.treatmentEndsAt);

  return { state: 'clears', at: lastDose + days * DAY_MS };
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
    /**
     * EVERY subject the treatment names, not the first one it happens to have.
     *
     * This was `treatment.flockId ?? treatment.animalId`, which is correct for
     * the record the create schema allows — exactly one of the two — and wrong
     * for any other. A treatment carrying both held produce for the group and
     * held NOTHING for the animal it also named, while `treatmentsFor` listed
     * it against that animal: the screen showed a treatment and reported no
     * withdrawal in force.
     *
     * `medicationUpdateSchema` is `.partial()`, which drops the create schema's
     * refine, so such a record was reachable from any client. The applier now
     * refuses to write one — but this reads records that already exist, and it
     * must err long rather than trust that nothing ever wrote one. A false
     * clear on milk or meat is a regulatory event, and `read/withdrawals.ts`
     * says outright that it is the error this app is written never to make.
     */
    const subjects = [treatment.flockId, treatment.animalId].filter(
      (subject): subject is string => subject !== undefined && wanted.has(subject),
    );
    if (subjects.length === 0) continue;

    const window = withdrawalWindow(treatment, kind);
    if (window.state === 'none') continue;

    // Strictly greater: at the instant it clears, it is clear. An open course
    // never reaches this test — it has no instant to compare against, which is
    // the point.
    if (window.state === 'clears' && window.at <= now) continue;

    for (const subjectId of subjects) {
      active.push({
        kind,
        medicationId: treatment.id,
        medication: treatment.name,
        subjectId,
        clearsAt: window.state === 'clears' ? window.at : null,
      });
    }
  }

  /**
   * Soonest first, and an open course last.
   *
   * `longestWithdrawal` takes the tail, and a course still being dosed is
   * genuinely the one that clears last — it clears after every dated window
   * that exists, because its own date does not exist yet.
   */
  return active.sort((a, b) => {
    if (a.clearsAt === null) return b.clearsAt === null ? 0 : 1;
    if (b.clearsAt === null) return -1;
    return a.clearsAt - b.clearsAt;
  });
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
  const noun = active.kind === 'egg' ? 'Eggs' : active.kind === 'milk' ? 'Milk' : 'Meat';

  /**
   * An open course says what to do, because unlike every other message here
   * there is an action that ends it.
   *
   * No date and no countdown: there is nothing to count to, and inventing a
   * "clear in about N days" from the first dose is the arithmetic this whole
   * change exists to remove. Naming the record's own missing field is the only
   * honest thing to say, and it happens to be the instruction.
   */
  if (active.clearsAt === null) {
    return `${noun} withheld — ${active.medication}. Still being given; record the last dose to start the clock.`;
  }

  const days = daysUntilClear(active.clearsAt, now);
  const when = new Date(active.clearsAt).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  return `${noun} withheld — ${active.medication}. Clear ${when} (${days} ${days === 1 ? 'day' : 'days'}).`;
}
