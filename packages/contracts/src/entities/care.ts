import { z } from 'zod';

/**
 * Routine husbandry — the jobs that come round again.
 *
 * Worming, hoof trimming, minerals, vaccination, a parasite check. The scope
 * doc is explicit that these are **not a new subsystem**: they are recurring
 * intervals, and the due engine already takes those. All that was missing was
 * a record saying one had been done, because that record is what clears the
 * row.
 *
 * Append-only, like every other observation. "I wormed the goats on Tuesday"
 * is a fact, and a farm that corrects it does so by recording what actually
 * happened rather than by editing history — which matters here more than
 * elsewhere, because a worming interval is a drug-resistance question and the
 * dates are the evidence.
 *
 * Deliberately NOT `medication`. A worming dose is a medication and should be
 * recorded as one when there is a withdrawal to track; this is the lighter
 * record for the jobs that have no drug in them at all — hooves, minerals, a
 * look-over — and for the case where somebody just wants the interval kept.
 */

export const CARE_KINDS = [
  'worming',
  'hoof-trim',
  'mineral',
  'vaccination',
  'parasite-check',
  'dental',
  'health-check',
] as const;
export const careKindSchema = z.enum(CARE_KINDS);
export type CareKind = z.infer<typeof careKindSchema>;

/**
 * What each job is called once it has been done.
 *
 * Past tense, because every place these are read is reporting: the chip you
 * press to say what you did, and the history row that says what you did. A
 * present-tense table would need a second one beside it, and two tables of
 * seven words drift.
 *
 * Here rather than on the screen that first needed them, because the history
 * projection lives in `core` and cannot import from `apps/mobile`.
 */
export const CARE_KIND_LABELS: Record<CareKind, string> = {
  worming: 'Wormed',
  'hoof-trim': 'Trimmed feet',
  mineral: 'Minerals',
  vaccination: 'Vaccinated',
  'parasite-check': 'Checked for parasites',
  dental: 'Teeth',
  'health-check': 'Looked over',
};

export const careLogCreateSchema = z
  .object({
    occurredAt: z.number().int(),
    kind: careKindSchema,
    flockId: z.string().length(26).optional(),
    animalId: z.string().length(26).optional(),
    /**
     * What was used, when it matters. Free text on purpose: a wormer brand is
     * not a medication record, and forcing one would mean either a fake
     * medication row or nothing recorded at all.
     */
    product: z.string().max(120).optional(),
    /** Animals treated, when the record covers a group rather than all of it. */
    animalsTreated: z.number().int().min(1).max(10_000).optional(),
    note: z.string().max(500).optional(),
  })
  .strict()
  .refine((c) => (c.animalId === undefined) !== (c.flockId === undefined), {
    message: 'A care log belongs to exactly one animal or one group',
  });
