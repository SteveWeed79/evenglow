import { z } from 'zod';
import { speciesSchema } from './livestock';

// ── task (mutable) ───────────────────────────────────────────────────────────

export const TASK_RECURRENCES = ['none', 'daily', 'weekly', 'monthly'] as const;

const taskShape = {
  title: z.string().min(1).max(120),
  dueAtDate: z.number().int().optional(),
  recurrence: z.enum(TASK_RECURRENCES).default('none'),
  completedAt: z.number().int().optional(),
  /** Links a chore to the machine or flock it concerns, for the Today list. */
  subjectId: z.string().length(26).optional(),
  note: z.string().max(500).optional(),
};

export const taskCreateSchema = z.object(taskShape).strict();
export const taskUpdateSchema = z.object(taskShape).partial().strict();

// ── photo (mutable) ──────────────────────────────────────────────────────────

/**
 * Metadata only — the Blob is uploaded separately in Phase 3, which is why
 * `uploadedAt` is optional: the record syncs before the bytes do.
 *
 * NOTE: CLAUDE.md's core types classify the other nine entities as append-only
 * or mutable but leave `photo` unassigned. Treated as mutable here so a photo
 * can be deleted; confirm when the upload path lands in Phase 3.
 */
const photoShape = {
  subjectId: z.string().length(26),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  byteSize: z.number().int().positive().max(25_000_000),
  capturedAt: z.number().int(),
  uploadedAt: z.number().int().optional(),
  caption: z.string().max(200).optional(),
};

export const photoCreateSchema = z.object(photoShape).strict();
export const photoUpdateSchema = z.object(photoShape).partial().strict();

// ── inventory (mutable) ──────────────────────────────────────────────────────

/**
 * Feed, bedding, medicine, and parts. Mutable rather than append-only: a stock
 * level is a running quantity that gets corrected, not an observation.
 *
 * `reorderBelow` is what makes this more than a list. The masterplan ties part
 * stock to upcoming service intervals so an alert fires before the window, and
 * that needs a threshold to compare the level against.
 */
export const INVENTORY_KINDS = ['feed', 'bedding', 'medicine', 'part', 'other'] as const;

/** Deliberately coarse. A smallholder counts bags and bales, not grams. */
export const INVENTORY_UNITS = ['kg', 'lb', 'bag', 'bale', 'litre', 'gallon', 'dose', 'each'] as const;

const inventoryShape = {
  name: z.string().min(1).max(120),
  kind: z.enum(INVENTORY_KINDS),
  unit: z.enum(INVENTORY_UNITS),
  /** Non-negative, and fractional on purpose — half a bale is a real quantity. */
  quantity: z.number().nonnegative(),
  /** Alert threshold. Absent means the item is tracked but never nags. */
  reorderBelow: z.number().nonnegative().optional(),
  /**
   * Who it is for. Chick starter is not goat feed.
   *
   * **Absent means "not said", never "for nothing"** — which is why an empty
   * array is refused rather than allowed to mean the same thing twice. Every
   * item on every shelf predates this field, and a farm that never answers it
   * must keep being offered all of its feed.
   *
   * A hint, not a rule. The feed screen sorts by it and never hides on it: a
   * keeper who puts chick crumb in front of a poorly bantam, or scratch in
   * front of the goats because it is what is open, is doing an ordinary thing.
   * A shelf that argued with them would be one they stopped filling in.
   */
  species: z.array(speciesSchema).min(1).optional(),
  /**
   * What this sack's scoop holds, in grams.
   *
   * **The scoop is the unit a farm actually uses**, twice a day, with a glove
   * on — so removing it would be the app being pedantic about the one measure
   * that gets used. What was wrong was not the scoop, it was that the app
   * guessed at it: a hardcoded 907 g went into every record, and because it was
   * a guess the shelf could not honestly be drawn down for it.
   *
   * Told rather than guessed, and told **per sack**, because that is where a
   * scoop lives: the one in the chick crumb is not the one in the goat mix.
   * Once a farm has said, a scoop is exact — the record is right and the sack
   * comes down by the same amount as pounds would.
   *
   * Absent keeps the old behaviour: the log uses the estimate and the shelf is
   * left alone. Nothing is lost by never answering.
   */
  scoopGrams: z.number().int().positive().max(100_000).optional(),
  /** Links a part to the machine it services, so W5 can warn before the window. */
  equipmentId: z.string().length(26).optional(),
  supplier: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
};

export const inventoryCreateSchema = z.object(inventoryShape).strict();
export const inventoryUpdateSchema = z.object(inventoryShape).partial().strict();

// ── shared ───────────────────────────────────────────────────────────────────

/** Delete payload. Reason is optional and surfaces in the audit trail. */
export const deleteSchema = z.object({ reason: z.string().max(200).optional() }).strict();
