import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { newId, TASK_RECURRENCES } from '@steading/contracts';
import { isSettled, listTasks, type Task } from '@steading/core/read/tasks';
import { Choice, Confirm, DayPick, Failure, Field, Primary, Row, TextField, Toggle, useSaver } from '../components/Form';
import { Loading } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useLog } from '../hooks/useSync';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

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
  const finished = tasks.filter(isSettled);

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
            icon="date-due"
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
          <Text style={[styles.label, { color: colors.muted }]}>Done</Text>
          {finished.map((task) => (
            <Row
              key={task.id}
              title={task.title}
              detail={
                task.completedAt === undefined
                  ? 'Finished'
                  : `Finished ${new Date(task.completedAt).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'long',
                    })}`
              }
              icon="check"
              testID={`job-done-${task.id}`}
              // Tapping a finished job re-opens it: the commonest reason to
              // look at this list is having ticked the wrong one.
              onPress={() =>
                void log({
                  entity: 'task',
                  op: 'update',
                  targetId: task.id,
                  payload: { completedAt: undefined },
                })
              }
            />
          ))}
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

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

const styles = StyleSheet.create({
  job: { gap: SPACE.xs },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: SPACE.md,
  },
});
