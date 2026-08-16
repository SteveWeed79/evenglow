import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { newId, TASK_RECURRENCES } from '@steading/contracts';
import { isSettled, listTasks, type Task } from '@steading/core/read/tasks';
import { Choice, Confirm, DayPick, Failure, Field, Primary, Row, TextField, Toggle, useSaver } from '../components/Form';
import { Icon } from '../components/Icon';
import { Loading } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useLog } from '../hooks/useSync';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TAP, TYPE } from '../theme/tokens';

/**
 * The jobs a farm writes down itself.
 *
 * `DUE_KINDS` has listed `task` as "a chore the farm entered itself" since the
 * engine was written, and nothing could create one. Every row on Today was
 * derived from a record, so there was no way to say *fix the gate* — the one
 * thing every list app in the world can do.
 *
 * ## Adding is on this screen, not behind another one
 *
 * A jobs list whose add button opens a second screen is a jobs list people use
 * once. The form is three fields and it lives here, closed until wanted.
 *
 * ## A date is optional, and that decides where the job appears
 *
 * With a date it becomes a due row on Today. Without one it stays here and
 * never nags — *replace the shed roof* is a note, not a job for this morning,
 * and putting it on Today for ever is how a list stops being read. See
 * `taskDues`.
 */

const RECURRENCE_LABELS: Record<string, string> = {
  none: 'Once',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
};

export function JobsScreen(): React.ReactElement {
  const tasks = useLive(listTasks, 'your jobs');
  const log = useLog();
  const { colors } = useTheme();

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [recurrence, setRecurrence] = useState<(typeof TASK_RECURRENCES)[number]>('none');
  const [dated, setDated] = useState(true);
  const [dueAtDate, setDueAtDate] = useState(() => startOfDay(Date.now()));

  const { saving, failure, save } = useSaver(
    useCallback(() => {
      setAdding(false);
      setTitle('');
      setRecurrence('none');
      setDated(true);
    }, []),
  );

  const commit = useCallback(() => {
    void save(async () => {
      await log({
        entity: 'task',
        op: 'create',
        targetId: newId(),
        payload: {
          title: title.trim(),
          recurrence,
          ...(dated ? { dueAtDate } : {}),
        },
      });
    });
  }, [save, log, title, recurrence, dated, dueAtDate]);

  /**
   * Finishing from here rather than from Today.
   *
   * The same write the Done button on Today makes — `completedAt` on the task
   * — because a chore is the one kind with nothing else to log. See the note
   * on `taskDues` for why a completion flag is right here and nowhere else.
   */
  const finish = useCallback(
    (task: Task) => {
      void log({
        entity: 'task',
        op: 'update',
        targetId: task.id,
        payload: { completedAt: Date.now() },
      });
    },
    [log],
  );

  const remove = useCallback(
    (task: Task) => {
      // Archived, never deleted (P13) — `delete` sets `archivedAt` server-side.
      void log({ entity: 'task', op: 'delete', targetId: task.id, payload: {} });
    },
    [log],
  );

  if (tasks === null) return <Loading title="Jobs" />;

  const open = tasks.filter((task) => !isSettled(task));

  /**
   * Only what was finished today, and that is the change.
   *
   * Every finished job used to stay here for ever, so a farm that had used the
   * app for a season scrolled past a graveyard to reach the jobs it still had
   * to do. Keeping today's gives the whole day to undo a mis-tap — which is
   * the only reason to look at a finished job — and by morning the list is
   * back to being about work.
   *
   * **They are not lost.** A completed task now appears in What happened on
   * the day it was done, which is what makes letting go of it here safe. That
   * projection had to be taught about tasks first: everything else in it is
   * append-only, and this is the one mutable row whose `completedAt` is a fact
   * rather than a flag.
   */
  const finished = tasks.filter(
    (task) =>
      isSettled(task) &&
      task.completedAt !== undefined &&
      task.completedAt >= startOfDay(Date.now()),
  );

  return (
    <Screen title="Jobs" back>
      {open.length === 0 && !adding ? (
        <Panel label="Nothing written down">
          <Body>
            Everything else on Today comes from what you log — a treatment, an hour reading, a
            set of eggs. This is for the rest: fix the gate, ring the vet, order the wormer.
          </Body>
        </Panel>
      ) : null}

      {open.map((task) => (
        <View key={task.id} style={styles.job}>
          <Row
            title={task.title}
            detail={detailOf(task)}
            // A tick, not a chevron: pressing this finishes the job rather
            // than opening anything, and the mark is the promise.
            mark="check"
            testID={`job-${task.id}`}
            onPress={() => finish(task)}
          />
          <Confirm
            label="Remove it"
            armedLabel="Tap again to remove"
            onConfirm={() => remove(task)}
          />
        </View>
      ))}

      {adding ? (
        <Panel label="A new job">
          <Field label="What needs doing?">
            <TextField
              value={title}
              onChangeText={setTitle}
              placeholder="Fix the gate, ring the vet"
              maxLength={120}
              testID="job-title"
            />
          </Field>

          <Field label="How often?">
            <Choice
              options={TASK_RECURRENCES}
              value={recurrence}
              onChange={setRecurrence}
              labels={RECURRENCE_LABELS}
            />
          </Field>

          <Field
            label="Put it on Today"
            hint="A job with no date stays on this screen and never nags. A job with one appears on Today when it is near."
          >
            <Toggle
              label={dated ? 'Yes, from a date' : 'No, just keep it here'}
              value={dated}
              onChange={setDated}
              testID="job-dated"
            />
          </Field>

          {dated ? (
            <Field label="From when?">
              <DayPick value={dueAtDate} onChange={setDueAtDate} />
            </Field>
          ) : null}

          <Failure message={failure} />

          <Primary
            label="Add it"
            disabled={saving || title.trim() === ''}
            onPress={commit}
            testID="save-job"
          />
        </Panel>
      ) : (
        <Primary label="Write down a job" onPress={() => setAdding(true)} testID="add-job" />
      )}

      {finished.length > 0 ? (
        <>
          <Text style={[styles.label, { color: colors.muted }]}>Done today</Text>
          {finished.map((task) => (
            <View key={task.id} style={styles.job}>
              {/**
                * A finished job, drawn as finished.
                *
                * It used to be a `Row` — a chevron promising it opened
                * something, and a single tap that silently un-finished it
                * instead. Two lies in one control: the mark said "opens" and
                * the tap said nothing at all while undoing the thing the farm
                * had just done.
                *
                * It is not pressable now. Reopening is its own deliberate
                * control below, because ticking a job is the ordinary act and
                * un-ticking is the exception.
                */}
              <View
                style={[styles.done, { backgroundColor: colors.raised, borderColor: colors.border }]}
                testID={`job-done-${task.id}`}
                accessible
                accessibilityLabel={`${task.title}. Done ${finishedWhen(task)}.`}
              >
                <Icon name="check" size={24} color={colors.leaf} />
                <View style={styles.doneWords}>
                  <Text style={[styles.doneTitle, { color: colors.muted }]}>{task.title}</Text>
                  <Text style={[styles.doneWhen, { color: colors.muted }]}>
                    Done {finishedWhen(task)}
                  </Text>
                </View>
              </View>

              {/* `null`, not `undefined`. This button wrote `undefined` until
                  the wire had a word for clearing a field, and the tick came
                  off this handset and nowhere else: `JSON.stringify` dropped
                  the key, the server's `$set` left `completedAt` standing, and
                  every other device on the farm went on showing the job done.
                  See `contracts/clearing.ts`. */}
              <Confirm
                label="Need to redo this"
                armedLabel="Tap again to put it back"
                testID={`job-redo-${task.id}`}
                onConfirm={() =>
                  void log({
                    entity: 'task',
                    op: 'update',
                    targetId: task.id,
                    payload: { completedAt: null },
                  })
                }
              />
            </View>
          ))}

          {/* Where they go, said out loud — otherwise tomorrow's empty section
              reads as the app having lost them. */}
          <Body>
            These clear overnight. They stay in What happened, on the day you did them.
          </Body>
        </>
      ) : null}
    </Screen>
  );
}

/** What a job's row says under its title. */
function detailOf(task: Task): string {
  const every =
    task.recurrence === 'none' ? null : (RECURRENCE_LABELS[task.recurrence] ?? 'Repeating');

  if (task.dueAtDate === undefined) {
    return every === null ? 'No date — tap when it is done' : `${every} — no date yet`;
  }

  const when = new Date(task.dueAtDate).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  });
  return every === null ? `${when} — tap when it is done` : `${when}, then ${every.toLowerCase()}`;
}

/** "at 8:52am", or the date if a clock has crossed midnight mid-render. */
function finishedWhen(task: Task): string {
  if (task.completedAt === undefined) return 'today';

  return `at ${new Date(task.completedAt).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

const styles = StyleSheet.create({
  job: { gap: SPACE.xs },
  done: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    minHeight: TAP.min,
    padding: SPACE.md,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
  },
  doneWords: { flex: 1, gap: 2 },
  /** Struck through, so it reads as finished before a word of it is read. */
  doneTitle: { fontFamily: FONTS.body, fontSize: TYPE.body, textDecorationLine: 'line-through' },
  doneWhen: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.4 },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: SPACE.md,
  },
});
