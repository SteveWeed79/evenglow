import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type Due, newId, TASK_RECURRENCES, taskDues, urgencyOf } from '@steading/contracts';
import { listTaskCompletions } from '@steading/core/read/completions';
import { listGroups } from '@steading/core/read/groups';
import { listMachines } from '@steading/core/read/iron';
import { isSettled, listTasks, type Task } from '@steading/core/read/tasks';
import { dueWhen } from '../components/DueRow';
import { Chip, Choice, Confirm, DayPick, Failure, Field, Primary, Row, TextField, Toggle, useSaver } from '../components/Form';
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
 *
 * ## The engine reads this list too, and now the list reads back
 *
 * This screen is the one place a due row could not be given a `Coming` panel,
 * because it *is* the task list — a panel of the same rows above the same rows
 * is Today with a different heading. What it lacked was the engine's sense of
 * time, which it had been quietly reimplementing worse:
 *
 * - **A date is not a verdict.** The detail line printed "3 September"
 *   whether that was next month or three weeks ago, so a job nobody had done
 *   looked exactly like one nobody needed to do yet. `urgencyOf` knows the
 *   difference and `dueWhen` has the words for it — the same words Today uses,
 *   shared rather than written twice.
 * - **A recurring job sorted by the wrong date.** `listTasks` orders by
 *   `dueAtDate`, which for a weekly chore done yesterday is the Monday it
 *   started from rather than next Thursday. `taskDues` already computes the
 *   next occurrence, so the list sorts on that.
 *
 * ## And a job can finally say what it is for
 *
 * `taskShape.subjectId` has existed since the schema was written — *"links a
 * chore to the machine or flock it concerns"* — `useDues` reads it to put the
 * group's name on the row, and **nothing in this app could set it.** A builder
 * with no caller, the lesson `useDues` already records about itself.
 *
 * It costs more now than it did. `Coming` shows a group its own chores through
 * `Due.about`, so *order the wormer* can sit on the does' screen beside their
 * worming schedule — and without a way to pin one, that path was reachable only
 * from a test.
 */

const RECURRENCE_LABELS: Record<string, string> = {
  none: 'Once',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
};

export function JobsScreen(): React.ReactElement {
  const tasks = useLive(listTasks, 'your jobs');
  const groups = useLive(listGroups);
  const machines = useLive(listMachines);
  const log = useLog();
  const { colors } = useTheme();

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [recurrence, setRecurrence] = useState<(typeof TASK_RECURRENCES)[number]>('none');
  const [dated, setDated] = useState(true);
  const [dueAtDate, setDueAtDate] = useState(() => startOfDay(Date.now()));
  /** What the job is about, or null for one that belongs to the farm at large. */
  const [subjectId, setSubjectId] = useState<string | null>(null);

  const { saving, failure, save } = useSaver(
    useCallback(() => {
      setAdding(false);
      setTitle('');
      setRecurrence('none');
      setDated(true);
      setSubjectId(null);
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
          ...(subjectId === null ? {} : { subjectId }),
        },
      });
    });
  }, [save, log, title, recurrence, dated, dueAtDate, subjectId]);

  /**
   * Finishing from here rather than from Today.
   *
   * The same write the Done button on Today makes — a `taskCompletion` event —
   * because a chore is the one kind with nothing else to log. It used to be
   * `completedAt` on the task itself, which each finishing overwrote, so a
   * weekly job done fifty times a year left one date behind. See
   * `entities/completions.ts`.
   */
  const finish = useCallback(
    (task: Task) => {
      void log({
        entity: 'taskCompletion',
        op: 'create',
        targetId: newId(),
        payload: { taskId: task.id, completedAt: Date.now() },
      });
    },
    [log],
  );

  /**
   * Putting a job back, which is a delete now rather than a clear.
   *
   * ## The bug this used to be, and why it is gone rather than fixed
   *
   * This wrote `{ completedAt: null }` — `APPROVED-WORK.md` §1 names it as one
   * of the two live symptoms of the clearing defect, and before the wire had a
   * word for clearing it sent `undefined`, which `JSON.stringify` dropped: the
   * tick came off this handset and every other device on the farm went on
   * showing the job done.
   *
   * Against an event there is nothing to clear. Un-finishing is deleting the
   * completion, which is an ordinary append-only take-back and has crossed the
   * wire since the day append-only entities learned to accept a delete. The
   * newest one, because a recurring job has several and putting one back means
   * the one just done.
   *
   * **The old field is still cleared when it is the only thing there is.** A
   * job finished by a build that predates this has a stored `completedAt` and
   * no event, and it must still be possible to put back — which is exactly the
   * case the clearing contract was built for, so the null stays for it.
   */
  const reopen = useCallback(
    (task: Task) => {
      void (async () => {
        const newest = (await listTaskCompletions()).find(
          (event) => event.taskId === task.id,
        );

        if (newest === undefined) {
          await log({
            entity: 'task',
            op: 'update',
            targetId: task.id,
            payload: { completedAt: null },
          });
          return;
        }

        await log({
          entity: 'taskCompletion',
          op: 'delete',
          targetId: newest.id,
          payload: {},
        });
      })();
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

  const now = Date.now();

  /**
   * What each job is pinned to, named.
   *
   * Groups and machines together, because `subjectId` is one field and a chore
   * is hung on whichever of them it concerns. A name that no longer resolves —
   * an archived group — is not blanked: hiding a group must not silently
   * rewrite what a job was for (invariant 13, the rule `listHistory` states).
   */
  const subjectNames = new Map<string, string>([
    ...(groups ?? []).map((group): [string, string] => [group.id, group.name]),
    ...(machines ?? []).map((machine): [string, string] => [machine.id, machine.name]),
  ]);
  const nameOf = (id: string): string => subjectNames.get(id) ?? 'something no longer listed';

  /**
   * The due row a job produces, keyed by the job.
   *
   * The engine's answer rather than the screen's: a recurring job's next
   * occurrence counts from when it was last done, and a job with no date
   * produces nothing at all — which is exactly the "stays here and never nags"
   * behaviour this screen is built around, so an absent row is not a gap.
   */
  const dueOf = new Map<string, Due>();
  for (const task of tasks) {
    const [due] = taskDues(task);
    if (due !== undefined) dueOf.set(task.id, due);
  }

  const open = tasks
    .filter((task) => !isSettled(task))
    // Soonest first, and the undated ones last: they are notes rather than
    // work, and a list that opens on "replace the shed roof" is one that has
    // buried this morning's job.
    .sort((a, b) => (dueOf.get(a.id)?.at ?? Infinity) - (dueOf.get(b.id)?.at ?? Infinity));

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

      {open.map((task) => {
        const due = dueOf.get(task.id);
        const late = due !== undefined && urgencyOf(due, now) === 'overdue';

        return (
          <View key={task.id} style={styles.job}>
            <Row
              title={task.title}
              detail={detailOf(task, due, now, nameOf)}
              // A tick, not a chevron: pressing this finishes the job rather
              // than opening anything, and the mark is the promise.
              mark="check"
              tone={late ? 'alert' : 'plain'}
              testID={`job-${task.id}`}
              onPress={() => finish(task)}
            />
            <Confirm
              label="Remove it"
              armedLabel="Tap again to remove"
              onConfirm={() => remove(task)}
            />
          </View>
        );
      })}

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

          {/**
            * What it is for, which is what puts it on that thing's screen.
            *
            * Offered only when the farm has something to pin a job to — on a
            * farm with no groups and no machines this is a field with one chip
            * saying "the farm", which is a question with no second answer.
            *
            * Groups and machines in one row rather than two fields, because
            * `subjectId` is one field and asking "is it about an animal or a
            * machine" first would be a tap spent narrowing a list of four.
            */}
          {subjectNames.size === 0 ? null : (
            <Field
              label="What is it for?"
              hint="A job pinned to something shows up on that thing’s own screen."
            >
              <View style={styles.subjects}>
                <Chip
                  label="The farm"
                  selected={subjectId === null}
                  testID="job-for-farm"
                  onPress={() => setSubjectId(null)}
                />
                {[...subjectNames].map(([id, name]) => (
                  <Chip
                    key={id}
                    label={name}
                    selected={subjectId === id}
                    testID={`job-for-${id}`}
                    onPress={() => setSubjectId(id)}
                  />
                ))}
              </View>
            </Field>
          )}

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

              {/* Deletes the completion event rather than clearing a field.
                  See `reopen` above for the bug that used to live here, and
                  why an append-only completion makes it impossible rather than
                  fixed. */}
              <Confirm
                label="Need to redo this"
                armedLabel="Tap again to put it back"
                testID={`job-redo-${task.id}`}
                onConfirm={() => reopen(task)}
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

/**
 * What a job's row says under its title.
 *
 * ## The date used to be all it said, and a date is not a verdict
 *
 * "3 September" is the same eleven characters whether it is next month or three
 * weeks gone, so the row that most needed reading looked exactly like the one
 * that did not. `dueWhen` is Today's own phrasing — "5 days ago", "tomorrow",
 * "in 3 weeks" — and the row goes rowan when `urgencyOf` calls it overdue.
 *
 * The absolute date is not lost: `dueWhen` widens to weeks and months as it
 * goes out, which is the resolution somebody actually plans at, and the exact
 * day is on the picker that set it.
 *
 * `due` is absent for a job with no date, and that is the designed state rather
 * than a missing value — such a job stays here and never nags.
 */
function detailOf(
  task: Task,
  due: Due | undefined,
  now: number,
  nameOf: (id: string) => string,
): string {
  const every =
    task.recurrence === 'none' ? null : (RECURRENCE_LABELS[task.recurrence] ?? 'Repeating');
  // Said last, because what a job is FOR matters less than when it is wanted.
  const about = task.subjectId === undefined ? '' : ` · ${nameOf(task.subjectId)}`;

  if (due === undefined) {
    const base = every === null ? 'No date — tap when it is done' : `${every} — no date yet`;
    return `${base}${about}`;
  }

  const when =
    urgencyOf(due, now) === 'overdue' ? `Was due ${dueWhen(due, now)}` : `Due ${dueWhen(due, now)}`;

  const base = every === null ? `${when} — tap when it is done` : `${when}, then ${every.toLowerCase()}`;
  return `${base}${about}`;
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
  subjects: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
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
