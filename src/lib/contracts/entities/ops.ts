import { z } from 'zod';

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

// ── shared ───────────────────────────────────────────────────────────────────

/** Delete payload. Reason is optional and surfaces in the audit trail. */
export const deleteSchema = z.object({ reason: z.string().max(200).optional() }).strict();
