import { type NoteSubject, noteCreateSchema } from '@steading/contracts';
import { localStore } from '../db/store';

/**
 * Notes, read back from the local projection.
 *
 * The same shape as every other reader here, and that is the point of having
 * built messaging this way: a note is an observation, so it needed no sync
 * work, no presence, no read state and no server beyond the one entity row.
 * It is written in a barn with no signal and appears on the other person's
 * phone when either device next reaches the network.
 */

export interface Note {
  id: string;
  occurredAt: number;
  subjectEntity: NoteSubject;
  subjectId: string;
  body: string;
  authorName?: string;
  /** Claimed by the writing device, for drawing an edit button. Never authority. */
  authorId?: string;
}

const storedNote = noteCreateSchema.partial();

export async function listNotes(): Promise<Note[]> {
  const records = await localStore().readRecordsByEntity('note');

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = storedNote.safeParse(record.value);
      if (
        !parsed.success ||
        parsed.data.occurredAt === undefined ||
        parsed.data.subjectEntity === undefined ||
        parsed.data.subjectId === undefined ||
        parsed.data.body === undefined
      ) {
        return [];
      }

      const { occurredAt, subjectEntity, subjectId, body, authorName, authorId } = parsed.data;
      return [
        {
          id: record.targetId,
          occurredAt,
          subjectEntity,
          subjectId,
          body,
          ...(authorName === undefined ? {} : { authorName }),
          ...(authorId === undefined ? {} : { authorId }),
        } satisfies Note,
      ];
    })
    .sort((a, b) => b.occurredAt - a.occurredAt);
}

/**
 * The thread on one thing, newest first.
 *
 * Matched on both halves of the subject. A `flock` id and an `equipment` id
 * come out of the same ULID space, so filtering on the id alone is a bug
 * waiting for the first collision — and the failure mode would be somebody's
 * note about a goat appearing on a tractor.
 */
export function notesOn(
  notes: readonly Note[],
  subjectEntity: NoteSubject,
  subjectId: string,
): Note[] {
  return notes.filter((n) => n.subjectEntity === subjectEntity && n.subjectId === subjectId);
}

/** How many notes each thing carries, for a row that says so without opening it. */
export function noteCounts(notes: readonly Note[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const note of notes) {
    const key = `${note.subjectEntity}:${note.subjectId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
