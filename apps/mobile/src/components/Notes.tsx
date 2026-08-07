import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { mayChangeNote, newId, type NoteSubject, type Role } from '@steading/contracts';
import { listNotes, type Note, notesOn } from '@steading/core/read/notes';
import { Confirm, Failure, Primary, Secondary, TextField, useSaver } from './Form';
import { Icon } from './Icon';
import { Body, Panel } from './Panel';
import { Touch } from './Touch';
import { readCachedClaims } from '../auth/session';
import { useLive } from '../hooks/useLive';
import { useLog } from '../hooks/useSync';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TAP, TYPE } from '../theme/tokens';

/**
 * The notes on one thing.
 *
 * **Collapsed to one line, with a count and the newest note.** The first
 * version of this rendered the whole thread inline and always open, which is
 * fine on an empty farm and wrong by the third note: the group hub has nine
 * action rows under it, and a wall of notes pushed the thing a person came to
 * do below the fold. A screen where the chore you opened it for is off-screen
 * is a screen that gets scrolled past.
 *
 * What stays visible collapsed is the part that is worth a glance — how many
 * there are, and the most recent one, which is almost always the one that
 * matters. Everything else is one tap.
 *
 * Inline rather than behind a route, still. A note is read and written
 * standing in front of the thing it is about, and a route would make it a
 * place you go rather than something you see.
 *
 * `entities/notes.ts` argues for why this is a note on a thing and not a chat.
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
  const [open, setOpen] = useState(false);
  /**
   * Which note is showing its options, at most one.
   *
   * Held here rather than per row on purpose. Each note used to render "Change
   * it" and "Delete it" permanently, so a thread of five drew ten full-width
   * buttons under five lines of text — the controls outweighed the content
   * they were about. Per-row state would fix the default and still allow every
   * row to be open at once, which is the same wall one tap later.
   */
  const [selected, setSelected] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [me, setMe] = useState<{ userId: string; role: Role } | null>(null);

  // The device's own identity, for the label a note carries and for deciding
  // whose notes show an edit button. Cached at sign-in because a barn has no
  // signal and no way to look either up.
  const [author, setAuthor] = useState<string | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void readCachedClaims().then((claims) => {
      if (!live || claims === null) return;
      setAuthor(claims.name);
      setMe({ userId: claims.userId, role: claims.role });
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
          ...(me === null ? {} : { authorId: me.userId }),
        },
      });
    });
  }, [save, log, body, subjectEntity, subjectId, author, me]);

  const thread = all === null ? [] : notesOn(all, subjectEntity, subjectId);
  const newest = thread[0];

  if (!open) {
    return (
      <Touch affordance="disclose"
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={
          thread.length === 0
            ? `Leave a note on ${subject}`
            : `${thread.length} notes on ${subject}. Newest: ${newest?.body ?? ''}`
        }
        testID={`notes-open-${subjectId}`}
        style={({ pressed }) => [
          styles.collapsed,
          {
            backgroundColor: colors.raised,
            borderColor: colors.border,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Icon name="edit" size={24} color={thread.length === 0 ? colors.muted : colors.lanternInk} />

        <View style={styles.collapsedWords}>
          <View style={styles.head}>
            <Text style={[styles.label, { color: colors.muted }]}>Notes</Text>
            {/* The badge, and it is a count rather than an unread marker.
                Nothing here tracks what anybody has read — see notes.ts on why
                read state is the part of a chat this app declines to have. */}
            {thread.length > 0 ? (
              <View style={[styles.badge, { backgroundColor: colors.lantern }]}>
                <Text style={[styles.badgeCount, { color: colors.lanternOn }]}>
                  {thread.length}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={[styles.preview, { color: colors.ink }]} numberOfLines={1}>
            {newest === undefined
              ? 'Anything the next person needs to know'
              : `${newest.authorName ?? 'Someone'}: ${newest.body}`}
          </Text>
        </View>

        <Icon name="forward" size={20} color={colors.muted} />
      </Touch>
    );
  }

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
            <NoteRow
              key={note.id}
              note={note}
              me={me}
              selected={selected === note.id}
              onSelect={() => setSelected(selected === note.id ? null : note.id)}
            />
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

      <Secondary
        label="Close notes"
        icon="close"
        onPress={() => setOpen(false)}
        testID={`notes-close-${subjectId}`}
      />
    </Panel>
  );
}

/**
 * One note, and the two ways to take it back — behind a tap.
 *
 * ## Why they are not just sitting there
 *
 * "Having the change-it or leave-it button take up that much space for a
 * single note seems pointless. Could the user select the note and have those
 * options within?"
 *
 * Yes, and it is the same mistake as several others in this app: a permanent
 * control for a rare action. A note is written once and read many times;
 * changing or deleting one is the exception. Two full-width buttons under
 * every line of text meant the controls outweighed the thing they were about,
 * and on a five-note thread the notes were the minority of the panel.
 *
 * So the note is the control. Tap it and the options appear inside it; tap it
 * again and they fold away. One note at a time — the parent holds that — so
 * the thread cannot become a wall again one tap later.
 *
 * ## Only where a tap would do something
 *
 * A note this person may not change is **not pressable**, rather than
 * pressable and empty. The mark on the right is the promise: three dots where
 * there is something behind it, nothing where there is not.
 *
 * The buttons appear only on notes this person may change — their own, or any
 * of them if they run the farm. That is UX only (invariant 8): a hand who got
 * past this would have the edit refused at apply time by the same rule,
 * checked against the server's own `createdBy` rather than the label below.
 */
function NoteRow({
  note,
  me,
  selected,
  onSelect,
}: {
  note: Note;
  me: { userId: string; role: Role } | null;
  selected: boolean;
  onSelect: () => void;
}): React.ReactElement {
  const log = useLog();
  const { colors } = useTheme();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);

  /**
   * Folding a note away abandons an edit in progress.
   *
   * Without this, opening a second note and coming back would show a
   * half-typed draft with no indication it was ever open — and worse, the
   * editor is what the tap toggles, so a stale `editing` would reopen straight
   * into a text box somebody had walked away from.
   */
  useEffect(() => {
    if (selected) return;
    setEditing(false);
    setDraft(note.body);
  }, [selected, note.body]);

  const edited = useSaver(useCallback(() => setEditing(false), []));
  const removed = useSaver(useCallback(() => undefined, []));

  const saveEdit = useCallback(() => {
    const written = draft.trim();
    if (written === '' || written === note.body) {
      setEditing(false);
      return;
    }
    void edited.save(async () => {
      // The body and nothing else. A note that could change its subject would
      // mean its whole meaning shifting under someone who had already read it.
      await log({ entity: 'note', op: 'update', targetId: note.id, payload: { body: written } });
    });
  }, [edited, log, draft, note.id, note.body]);

  const remove = useCallback(() => {
    void removed.save(async () => {
      // Archived rather than deleted (P13): it leaves the thread, the row stays.
      await log({ entity: 'note', op: 'delete', targetId: note.id, payload: {} });
    });
  }, [removed, log, note.id]);

  const mine = me !== null && mayChangeNote(me.role, me.userId, note.authorId);

  return (
    <View style={[styles.note, { backgroundColor: colors.ground, borderColor: colors.border }]}>
      {editing ? (
        <>
          <TextField
            value={draft}
            onChangeText={setDraft}
            maxLength={1000}
            multiline
            testID={`note-edit-${note.id}`}
          />
          <Failure message={edited.failure} />
          <Primary
            label="Save the change"
            disabled={edited.saving || draft.trim() === ''}
            onPress={saveEdit}
            testID={`note-edit-save-${note.id}`}
          />
          <Secondary
            label="Leave it as it was"
            onPress={() => {
              setDraft(note.body);
              setEditing(false);
            }}
            testID={`note-edit-cancel-${note.id}`}
          />
        </>
      ) : (
        <>
          {/* The note IS the control, where there is one. A note somebody may
              not change is plain text, not a button that does nothing. */}
          <Touch affordance="disclose"
            onPress={mine ? onSelect : undefined}
            disabled={!mine}
            {...(mine
              ? {
                  accessibilityRole: 'button' as const,
                  accessibilityState: { expanded: selected },
                  accessibilityLabel: selected
                    ? `${note.body}. Showing options.`
                    : `${note.body}. Tap for options.`,
                }
              : {})}
            testID={`note-${note.id}`}
            style={({ pressed }) => [styles.said, { opacity: pressed && mine ? 0.7 : 1 }]}
          >
            <Text style={[styles.body, { color: colors.ink }]}>{note.body}</Text>

            <View style={styles.by}>
              <Icon name="head-count" size={16} color={colors.muted} />
              <Text style={[styles.byline, { color: colors.muted }]}>
                {/* Unattributed rather than guessed at: a note that synced from a
                    build without a name should not claim to be from this device. */}
                {note.authorName ?? 'Someone on the farm'} · {when(note.occurredAt)}
              </Text>
              {/* The promise, and only where it is true. */}
              {mine ? (
                <Icon name={selected ? 'minus' : 'more'} size={16} color={colors.muted} />
              ) : null}
            </View>
          </Touch>

          {mine && selected ? (
            <View style={styles.actions}>
              {/* Side by side rather than stacked. They are scoped to one note
                  now, so they no longer need to be the width of the thread. */}
              <View style={styles.pair}>
                <View style={styles.half}>
                  <Secondary
                    label="Change it"
                    icon="edit"
                    onPress={() => setEditing(true)}
                    testID={`note-edit-open-${note.id}`}
                  />
                </View>
                <View style={styles.half}>
                  {/* Two taps, like everywhere else that destroys work a person
                      entered. */}
                  <Confirm
                    label="Delete it"
                    armedLabel="Tap again"
                    onConfirm={remove}
                    testID={`note-delete-${note.id}`}
                  />
                </View>
              </View>
              <Failure message={removed.failure} />
            </View>
          ) : null}
        </>
      )}
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
  collapsed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    minHeight: TAP.min,
    padding: SPACE.md,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
  },
  collapsedWords: { flex: 1, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.xs,
  },
  badgeCount: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    fontVariant: ['tabular-nums'],
  },
  preview: { fontFamily: FONTS.body, fontSize: TYPE.body },
  thread: { gap: SPACE.sm },
  note: {
    padding: SPACE.md,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    gap: SPACE.xs,
  },
  body: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.35 },
  said: { gap: SPACE.xs },
  by: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs + 2 },
  pair: { flexDirection: 'row', gap: SPACE.sm },
  half: { flex: 1 },
  byline: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.4 },
  actions: { gap: SPACE.sm, marginTop: SPACE.xs },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
