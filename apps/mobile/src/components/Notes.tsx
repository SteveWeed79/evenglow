import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { newId, type NoteSubject } from '@steading/contracts';
import { listNotes, type Note, notesOn } from '@steading/core/read/notes';
import { Failure, Primary, TextField, useSaver } from './Form';
import { Icon } from './Icon';
import { Body, Panel } from './Panel';
import { readCachedClaims } from '../auth/session';
import { useLive } from '../hooks/useLive';
import { useLog } from '../hooks/useSync';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TYPE } from '../theme/tokens';

/**
 * The notes on one thing, and the box to add another.
 *
 * Inline rather than behind a route, and that is the whole design. A note is
 * read and written standing in front of the thing it is about — the goat, the
 * tractor, the bed — so putting it one tap away would make it a place you go
 * rather than something you see. The extra tap is exactly the cost that stops
 * people leaving the note at all.
 *
 * `entities/notes.ts` argues at length for why this is a note on a thing and
 * not a chat. The short version: a chat has no subject, needs a signal, and
 * becomes a second inbox competing with Today.
 */
export function Notes({
  subjectEntity,
  subjectId,
  /** What the thing is called, so the empty state can say it. */
  subject,
}: {
  subjectEntity: NoteSubject;
  subjectId: string;
  subject: string;
}): React.ReactElement {
  const log = useLog();
  const { colors } = useTheme();

  const all = useLive(listNotes);
  const [body, setBody] = useState('');
  const [author, setAuthor] = useState<string | undefined>(undefined);

  // The device's own name, for the label the note carries. Cached at sign-in
  // because a barn has no signal and no way to look one up.
  useEffect(() => {
    let live = true;
    void readCachedClaims().then((claims) => {
      if (live) setAuthor(claims?.name);
    });
    return () => {
      live = false;
    };
  }, []);

  const { saving, failure, save } = useSaver(useCallback(() => setBody(''), []));

  const add = useCallback(() => {
    const written = body.trim();
    if (written === '') return;

    void save(async () => {
      await log({
        entity: 'note',
        op: 'create',
        targetId: newId(),
        payload: {
          occurredAt: Date.now(),
          subjectEntity,
          subjectId,
          body: written,
          ...(author === undefined ? {} : { authorName: author }),
        },
      });
    });
  }, [save, log, body, subjectEntity, subjectId, author]);

  const thread = all === null ? [] : notesOn(all, subjectEntity, subjectId);

  return (
    <Panel label={thread.length === 0 ? 'Notes' : `Notes (${thread.length})`}>
      {thread.length === 0 ? (
        <Body>
          {/* Empty screens invite (UX-SPEC §6), and this one has to say what
              it is for — nobody guesses that a note reaches the other people
              on the farm rather than sitting on this phone. */}
          Anything the next person needs to know about {subject}. Whoever else works this farm
          sees it, and it sends itself when you next have a signal.
        </Body>
      ) : (
        <View style={styles.thread}>
          {thread.map((note) => (
            <NoteRow key={note.id} note={note} />
          ))}
        </View>
      )}

      <TextField
        value={body}
        onChangeText={setBody}
        placeholder="Left teat looks hard, watch her"
        maxLength={1000}
        multiline
        testID={`note-body-${subjectId}`}
      />

      <Failure message={failure} />

      <Primary
        label="Leave a note"
        disabled={saving || body.trim() === ''}
        onPress={add}
        testID={`note-save-${subjectId}`}
      />

      {thread.length > 0 ? (
        <Text style={[styles.caveat, { color: colors.muted }]}>
          {/* Said once, where it matters, rather than discovered by trying. */}
          A note cannot be taken back once it has sent.
        </Text>
      ) : null}
    </Panel>
  );
}

function NoteRow({ note }: { note: Note }): React.ReactElement {
  const { colors } = useTheme();

  return (
    <View style={[styles.note, { backgroundColor: colors.ground, borderColor: colors.border }]}>
      <Text style={[styles.body, { color: colors.ink }]}>{note.body}</Text>
      <View style={styles.by}>
        <Icon name="head-count" size={16} color={colors.muted} />
        <Text style={[styles.byline, { color: colors.muted }]}>
          {/* Unattributed rather than guessed at: a note that synced from a
              build without a name should not claim to be from this device. */}
          {note.authorName ?? 'Someone on the farm'} · {when(note.occurredAt)}
        </Text>
      </View>
    </View>
  );
}

const DAY_MS = 86_400_000;

/**
 * When it was left, in the words someone would use.
 *
 * The clock time is kept for today only. "14:20" matters when the note is
 * about this morning's milking and is noise a fortnight later, where the day
 * is the whole answer.
 */
function when(at: number): string {
  const days = Math.round((Date.now() - at) / DAY_MS);

  if (days <= 0) {
    return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}

const styles = StyleSheet.create({
  thread: { gap: SPACE.sm },
  note: {
    padding: SPACE.md,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    gap: SPACE.xs,
  },
  body: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.35 },
  by: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs + 2 },
  byline: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.4 },
  caveat: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.4 },
});
