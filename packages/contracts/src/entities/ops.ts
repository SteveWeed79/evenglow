import { z } from 'zod';
import { updateSchemaOf } from '../clearing';
import { minorSchema } from '../money';
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
export const taskUpdateSchema = updateSchemaOf(taskShape);

// ── photo (mutable) ──────────────────────────────────────────────────────────

/**
 * Metadata only — the Blob is uploaded separately in Phase 3, which is why
 * `uploadedAt` is optional: the record syncs before the bytes do.
 *
 * NOTE: CLAUDE.md's core types classify the other nine entities as append-only
 * or mutable but leave `photo` unassigned. Treated as mutable here so a photo
 * can be deleted; confirm when the upload path lands in Phase 3.
 */
/**
 * The largest photo this app will carry, and the number is chosen to separate
 * two populations rather than to be generous.
 *
 * The device resizes to a 1600px long edge at JPEG quality 0.7 before anything
 * leaves it (`photos/store.ts`), which produces 200–400 KB typically and
 * around 1.2 MB for the densest subjects a farm photographs — a fleece, straw,
 * gravel. An un-resized frame from a modern phone camera is 4–8 MB.
 *
 * **Three megabytes sits above every resized output and below every raw
 * frame**, so it admits everything the app is built to send and refuses the one
 * thing that means the resize did not happen. It was 25 MB, which is sixty
 * times a typical photo and only reachable when something has already gone
 * wrong. *(The original argument added that twenty such files filled the free
 * managed tier the server ran on. That tier is gone — the database is on the
 * box now — and the ceiling stands on the resize argument alone, which is the
 * half that was never about capacity.)*
 *
 * `ACCESS-AND-BILLING.md` §4.1a asked for exactly this: *"lower the contract
 * ceiling to match reality so an oversized photo is refused at the boundary
 * with a sentence."* The boundary is what matters — refusing the record costs
 * nothing, where refusing after the upload has spent a barn's bandwidth twice.
 *
 * Raising `MAX_EDGE` on the device is what would make this too tight: 2048px at
 * the same quality reaches roughly 1.9 MB on a dense subject. There is headroom
 * for that, and not much more.
 */
export const MAX_PHOTO_BYTES = 3_000_000;

const photoShape = {
  subjectId: z.string().length(26),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  byteSize: z.number().int().positive().max(MAX_PHOTO_BYTES),
  capturedAt: z.number().int(),
  uploadedAt: z.number().int().optional(),
  caption: z.string().max(200).optional(),
};

export const photoCreateSchema = z.object(photoShape).strict();
export const photoUpdateSchema = updateSchemaOf(photoShape);

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
  /**
   * What ONE `unit` costs, in the farm's minor units.
   *
   * Per unit rather than per purchase, because `quantity` draws down as the
   * sack empties and a total paid would have to be re-divided every time to
   * stay meaningful. A rate is stable: half a bale still costs half a bale's
   * worth. The form asks what the farm paid and does the division, so nobody
   * works out 22 ÷ 50 standing in a feed store.
   *
   * Absent means never told, and everything costed stays silent rather than
   * counting it as free — a cost-per-egg with half the feed missing is worse
   * than no figure at all, because it looks like an answer.
   */
  costCents: minorSchema.max(100_000_000).optional(),
  /** Links a part to the machine it services, so W5 can warn before the window. */
  equipmentId: z.string().length(26).optional(),
  supplier: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
};

export const inventoryCreateSchema = z.object(inventoryShape).strict();
export const inventoryUpdateSchema = updateSchemaOf(inventoryShape);

// ── stockAdjustment (append-only) ────────────────────────────────────────────

/**
 * Why a shelf quantity moved, as a fact rather than an edit.
 *
 * Reported from a farm: *"users should be able to add direct quantities to the
 * items on the shelf as needed. Currently if an item is on the shelf it's there
 * until used. What if some is lost? Mice etc?"*
 *
 * Exactly right, and the gap was not that the number could not be changed —
 * `inventory` is mutable and `quantity` was always writable. It was that
 * changing it **said nothing**. A sack that went from ten to six left no trace
 * of whether it was fed out, sold, spilled, or eaten by something; and the one
 * thing the app could already do — draw the shelf down when feed was logged —
 * meant every *other* reason silently looked like consumption.
 *
 * That matters beyond tidiness. `feedCostPerEgg` divides what the feed cost by
 * what came off the birds, and a farm that loses a quarter of a sack to vermin
 * has not spent that on eggs. Counted as feed it inflates the cost of every egg
 * that year; counted as loss it is a number somebody can act on — which is the
 * difference between a figure and an accusation.
 *
 * ## Append-only, and paired rather than derived
 *
 * The adjustment is the history; `inventory.quantity` stays the running total,
 * for the reason it always was — *a stock level is a running quantity that gets
 * corrected, not an observation*. The screen writes both, the same way logging
 * feed already writes a `feedLog` and draws the sack down.
 *
 * The two can disagree after a concurrent edit on two handsets, and that is
 * accepted rather than overlooked: the quantity is last-write-wins by design,
 * and rebuilding a live stock level by replaying every adjustment ever made
 * would make the shelf unreadable offline. What the log guarantees is that the
 * *reasons* are all kept, which is what was missing.
 */
export const STOCK_REASONS = ['bought', 'used', 'lost', 'spoiled', 'miscounted', 'other'] as const;

export type StockReason = (typeof STOCK_REASONS)[number];

export const stockAdjustmentCreateSchema = z
  .object({
    itemId: z.string().length(26),
    /**
     * Signed, and never zero.
     *
     * Negative is what left the shelf. Zero is not a correction anybody makes —
     * it is a form submitted by accident — and accepting it would put rows in
     * the history that say nothing happened.
     *
     * Fractional for the same reason `quantity` is: half a bale is a real
     * amount, and so is half a bale gone mouldy.
     */
    delta: z.number().refine((value) => value !== 0, 'That is not a change.'),
    reason: z.enum(STOCK_REASONS),
    occurredAt: z.number().int(),
    note: z.string().max(500).optional(),
  })
  .strict();

// ── shared ───────────────────────────────────────────────────────────────────

/** Delete payload. Reason is optional and surfaces in the audit trail. */
export const deleteSchema = z.object({ reason: z.string().max(200).optional() }).strict();
