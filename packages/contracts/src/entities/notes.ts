import { z } from 'zod';
import type { Role } from '../roles';

/**
 * A note left on a thing.
 *
 * ## Why this and not a chat
 *
 * The ask was messaging between people on the same farm, and a chat is the
 * obvious shape and the wrong one here. Three reasons, in order of how much
 * they cost:
 *
 * **A chat has no subject.** "Did anyone drench the goats?" goes into a
 * stream and is found by scrolling. The same sentence on the goats is where
 * the next person would already be looking, and it is still there in March
 * when somebody asks why the worming interval slipped.
 *
 * **A chat wants presence, read state and a live ordering across devices.**
 * This app has no notification server and no cloud scheduler, on purpose (see
 * `due/types.ts`), and a chat that only works with a signal is a chat nobody
 * uses in a barn. A note rides the sync engine exactly as an egg count does:
 * written offline, queued, and there when it lands.
 *
 * **A chat becomes a second inbox.** The app already asks for a person's
 * attention once a day, on Today, and every row there is derived from
 * something real. Unread badges competing with it would train people to
 * ignore both.
 *
 * So: notes, anchored to a subject, sent by the same queue as everything
 * else. What is lost against a real chat is a general-purpose
 * conversation — "can you pick up feed on your way" belongs in a text
 * message, and that is fine.
 *
 * ## Mutable, unlike every other observation here
 *
 * This started append-only, matching every other observation, and that was
 * wrong for the one reason that matters: **a note is a message, not a
 * measurement.** An egg count entered wrong is corrected by recording what was
 * actually collected — the history is the point. A note with a typo, or one
 * left on the wrong animal, is embarrassing rather than historical, and a
 * person who cannot take it back stops leaving notes.
 *
 * The cost is conflict handling, and it is small here: only the body can
 * change, so two people editing the same note produce a last-writer-wins on
 * one string rather than a merge problem. Two people writing *different* notes
 * on the same animal with no signal still both keep what they wrote, because
 * those are two records — that case, the one that made messaging worth having,
 * is unaffected.
 *
 * Deletion is archival like everything else (P13). The note leaves the thread;
 * the row stays.
 */

/**
 * What a note can be left on.
 *
 * An explicit list rather than the whole entity enum. Every one of these is
 * something with a screen a person stands in front of; a note on an `eggLog`
 * or on another note is not a thing anyone means, and leaving the door open
 * would mean the UI deciding what was legal rather than the contract.
 */
export const NOTE_SUBJECTS = [
  'flock',
  'animal',
  'equipment',
  'maintenance',
  'planting',
  'bed',
  'site',
  'incubation',
  'breeding',
  'inventory',
] as const;

export const noteSubjectSchema = z.enum(NOTE_SUBJECTS);
export type NoteSubject = z.infer<typeof noteSubjectSchema>;

export const noteCreateSchema = z
  .object({
    occurredAt: z.number().int(),
    subjectEntity: noteSubjectSchema,
    subjectId: z.string().length(26),
    /**
     * One note. Long enough for "left teat looks hard, watch her" plus the
     * detail that makes it useful, short enough that nobody writes an essay
     * where a note belongs.
     */
    body: z.string().min(1).max(1000),
    /**
     * Who wrote it, for display — **recorded, never trusted**, exactly like
     * `clientTs` on the envelope.
     *
     * The device has to be able to say "Sam wrote this" while it has never
     * had a signal since Sam was added to the farm, so the name travels with
     * the note. The server independently stamps `updatedBy` from the verified
     * token, and that stamp is the audit trail; this string is a label.
     */
    authorName: z.string().max(80).optional(),
    /**
     * The same, for deciding whether to draw an edit button before the server
     * has been asked — cached claims gate local UX only (invariant 8).
     *
     * The server does not read this. It stamps `createdBy` from the verified
     * token at insert, and that is what `mayChangeNote` is checked against
     * when the edit actually arrives.
     */
    authorId: z.string().max(64).optional(),
  })
  .strict();

export type NoteCreate = z.infer<typeof noteCreateSchema>;

/**
 * Editing one.
 *
 * The body and nothing else. Moving a note to another animal is not an edit —
 * it is deleting one note and writing another, and letting the subject change
 * would mean a note's whole meaning could shift under someone who had already
 * read it. The time it was written is not editable for the same reason.
 */
export const noteUpdateSchema = z.object({ body: z.string().min(1).max(1000) }).strict();

/**
 * Whether this person may change this note.
 *
 * **Your own note, always. Anyone's note if you run the farm.** That is the
 * moderation model everybody already understands, and it is the one that lets
 * a farm hand — the person most likely to be leaving notes — fix their own
 * typo without needing the owner.
 *
 * Pure, and shared client and server for the same reason `canMutate` is: the
 * client uses it to decide whether to draw the buttons, the server uses it to
 * enforce. **The client copy is never the control** (invariant 8).
 *
 * Fails closed on an unknown author (invariant 10). A note carrying no
 * `createdBy` predates the stamp or arrived from somewhere that did not set
 * it; a hand cannot edit it, and an owner still can.
 */
export function mayChangeNote(
  actorRole: Role,
  actorId: string,
  createdBy: string | undefined,
): boolean {
  if (actorRole === 'owner' || actorRole === 'admin') return true;
  return createdBy !== undefined && createdBy === actorId;
}
