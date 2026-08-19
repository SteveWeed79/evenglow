import { z } from 'zod';

/**
 * Doing a job, as an event rather than a field.
 *
 * ## The field could only ever remember the last time
 *
 * `task.completedAt` and `maintenance.lastDoneAtDate` are single values that
 * each completion overwrites. A machine serviced every spring for six years
 * shows one date — the last one — and the five before it were never anywhere
 * to be lost from. `Evenglow-Masterplan.md` advertises a full service record to
 * hand over with a tractor, and that record could not be produced from a field
 * that holds one number.
 *
 * `read/history.ts` says so twice, once against each entity, in the same words:
 * *"the field is overwritten every time, so history shows the LAST service on
 * each schedule and not the ones before it… fixing it properly wants an
 * append-only completion record — the shape `careLog` already is for animals —
 * which is a schema change rather than a reader change."* This is that change.
 *
 * ## The schedule stays mutable and only the completion moves
 *
 * A `task` is still edited — its title, its date, how often it repeats — and a
 * `maintenance` is still a schedule somebody changes. What could not be edited
 * is the past, and that is exactly the half that becomes append-only (D3): a
 * completion's value cannot change, so two devices cannot disagree about it,
 * and a second device recording the same service produces a second event rather
 * than a conflict over one field.
 *
 * ## Which also gives un-completing something to delete
 *
 * `JobsScreen`'s *Need to redo this* wrote `{ completedAt: null }` — the field
 * that `APPROVED-WORK.md` §1 names as one of two live clearing symptoms, and
 * before the wire learned the word for clearing it cleared the handset and
 * nothing else. Against an event it is a `delete` of the event, which is an
 * ordinary append-only take-back and has always crossed the wire. The clearing
 * contract is still needed for the medication fields; this removes one of its
 * two customers.
 *
 * ## Nothing reading these had to change
 *
 * `taskDues` counts recurrence from `completedAt`, `isSettled` asks whether a
 * one-off is finished, `serviceDue` counts an interval from `lastDoneAtHours`.
 * All three go on reading the same field names — the reads fill them from the
 * newest event and fall back to the stored field, so a farm's existing records
 * keep working and the due engine did not need a line changed. See
 * `read/completions.ts`.
 */

// ── taskCompletion (append-only) ─────────────────────────────────────────────

const taskCompletionShape = {
  taskId: z.string().length(26),
  /**
   * When it was done.
   *
   * `completedAt` rather than the `occurredAt` every other append-only entity
   * uses, and the difference is deliberate: `DueDone.stampAs` already carries
   * both words and says why — *"`occurredAt` on an observation, `completedAt`
   * on a chore — the same press meaning 'now' in two vocabularies"*. A chore is
   * not an observation, and the field it fills on the reading side is called
   * `completedAt` too.
   */
  completedAt: z.number().int(),
  note: z.string().max(500).optional(),
};

export const taskCompletionCreateSchema = z.object(taskCompletionShape).strict();

// ── serviceCompletion (append-only) ──────────────────────────────────────────

const serviceCompletionShape = {
  /** The `maintenance` schedule this discharges. */
  serviceId: z.string().length(26),
  completedAt: z.number().int(),
  /**
   * The meter reading the work was actually done at.
   *
   * Optional because a date-based schedule has no meter, and because a machine
   * without one cannot answer. Where it exists it is the number the next
   * interval counts from — `ServiceDoneScreen` asks for it rather than taking
   * the last hour log, since the two are minutes apart on the day of a service.
   */
  atHours: z.number().nonnegative().optional(),
  note: z.string().max(500).optional(),
};

export const serviceCompletionCreateSchema = z.object(serviceCompletionShape).strict();
