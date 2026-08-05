import { z } from 'zod';

// ── equipment (mutable) ──────────────────────────────────────────────────────

const equipmentShape = {
  name: z.string().min(1).max(80),
  make: z.string().max(80).optional(),
  model: z.string().max(80).optional(),
  serial: z.string().max(80).optional(),
  year: z.number().int().min(1900).max(2200).optional(),
  /** Set when created from a preset, so factory intervals can be re-applied later (W4). */
  presetId: z.string().max(80).optional(),
  /** Assets without an hour meter (pumps, augers) are date-triggered only. */
  hasHourMeter: z.boolean().default(true),
  note: z.string().max(500).optional(),
};

export const equipmentCreateSchema = z.object(equipmentShape).strict();
export const equipmentUpdateSchema = z.object(equipmentShape).partial().strict();

// ── hourReading (append-only) ────────────────────────────────────────────────

/**
 * The basis for real maintenance intervals. A reading below the last recorded
 * value is rejected server-side at apply time — the contract cannot know the
 * previous value, so it validates shape only.
 */
export const hourReadingCreateSchema = z
  .object({
    occurredAt: z.number().int(),
    equipmentId: z.string().length(26),
    /** One decimal place is what hour meters actually show. */
    hours: z.number().nonnegative().max(1_000_000),
    note: z.string().max(500).optional(),
  })
  .strict();

// ── maintenance (mutable) ────────────────────────────────────────────────────

/**
 * Dual-trigger: engine hours OR calendar date, whichever comes first. At least
 * one trigger must be present or the schedule can never fire.
 */
const maintenanceShape = {
  equipmentId: z.string().length(26),
  title: z.string().min(1).max(120),
  intervalHours: z.number().positive().optional(),
  intervalDays: z.number().int().positive().optional(),
  dueAtHours: z.number().nonnegative().optional(),
  dueAtDate: z.number().int().optional(),
  lastDoneAtHours: z.number().nonnegative().optional(),
  lastDoneAtDate: z.number().int().optional(),
  /** Links a service to the parts it consumes, so low stock can warn early (P8). */
  partIds: z.array(z.string().length(26)).max(50).optional(),
  /**
   * What to look at while doing it — P15, the inspection checklist.
   *
   * On the schedule rather than on the machine, because the list is different
   * per job: a greasing walks the nipples and an oil change looks at the plug
   * and the filter seal. A single list per machine would be the union of every
   * job's, which is a list nobody reads to the end of.
   *
   * Plain strings, and in the order the machine is walked. Not entities: a
   * check has no history of its own worth keeping — what is worth keeping is
   * the job that comes out of one, and that is a `task`.
   *
   * Twenty is the cap because a checklist longer than a walkaround is one that
   * gets skipped wholesale, and a skipped list is worse than no list.
   */
  checks: z.array(z.string().min(1).max(80)).max(20).optional(),
  note: z.string().max(500).optional(),
};

const hasATrigger = (v: { intervalHours?: number | undefined; intervalDays?: number | undefined }) =>
  v.intervalHours !== undefined || v.intervalDays !== undefined;

export const maintenanceCreateSchema = z
  .object(maintenanceShape)
  .strict()
  .refine(hasATrigger, { message: 'A schedule needs an hour interval, a day interval, or both.' });

export const maintenanceUpdateSchema = z.object(maintenanceShape).partial().strict();
