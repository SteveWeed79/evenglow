import { z } from 'zod';

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
 * So: notes, anchored to a subject, append-only, sent by the same queue as
 * everything else. What is lost against a real chat is a general-purpose
 * conversation — "can you pick up feed on your way" belongs in a text
 * message, and that is fine.
 *
 * ## Append-only, and what that costs
 *
 * Like every other observation. A note cannot conflict, which means two people
 * writing on the same animal in the same minute with no signal both keep what
 * they wrote — and that is the case this has to get right, because it is the
 * case that made messaging worth having.
 *
 * The cost is real and stated plainly: **a note cannot be edited or deleted
 * once it has synced.** Before it syncs it can be thrown away from the
 * rejected inbox like any other queued work. If farms find themselves wanting
 * to retract notes, that is a signal this should have been mutable, and the
 * conversion is a schema change rather than a redesign.
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
  })
  .strict();

export type NoteCreate = z.infer<typeof noteCreateSchema>;
