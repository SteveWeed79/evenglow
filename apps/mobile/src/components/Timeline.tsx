import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type HistoryDay, type HistoryEvent, listHistory } from '@steading/core/read/history';
import { Confirm, Failure, useSaver } from './Form';
import { Icon } from './Icon';
import { Loading } from './Missing';
import { Body, Panel } from './Panel';
import { Touch } from './Touch';
import { useLive } from '../hooks/useLive';
import { useLog } from '../hooks/useSync';
import { useUnits } from '../hooks/useUnits';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TAP, TYPE } from '../theme/tokens';

/**
 * What has happened to one thing, and the rows every history is drawn from.
 *
 * ## Why this is a component and not a fourth copy of a list
 *
 * `GAP-ASSESSMENT-REVIEW` named one reusable detail-and-timeline screen as the
 * best single idea in the assessment: several entities stop at creation and a
 * static list, and a timeline is the half that makes each of them worth
 * opening. This is that half, and it is a panel rather than a screen so it can
 * go beneath whatever a group, a machine or a planting already shows.
 *
 * **The rows are shared rather than reimplemented.** `HistoryScreen` extracted
 * them once already, with the reason written on it: *"taking a record back has
 * to behave identically whichever container it happens to be in, and two
 * copies of a list whose rows delete things is two chances to get exactly that
 * wrong."* Three containers now, and one implementation.
 *
 * ## It reads through the scope, not by filtering afterwards
 *
 * `listHistory(units, { subject })` — see `read/history.ts`. A subject is what
 * a record *names*, so a group's timeline shows what was logged against the
 * group and does not climb down to its animals' weights; a loss that named
 * both appears on both. That is stated there and asserted in
 * `tests/unit/history-subject.test.ts`.
 *
 * ## What it shows when there is nothing
 *
 * A sentence, never an empty box. "Nothing logged against this yet" is a
 * different fact from a screen that failed to read, and `useLive` keeps the
 * loading branch rather than falling through to empty — the rule this app
 * repeats everywhere, because an empty list is indistinguishable from a farm
 * with no animals.
 */

/** How many days a panel shows before it stops. */
const DAYS = 10;

export function Timeline({
  subject,
  label = 'What happened',
}: {
  /** The record this timeline is about. */
  subject: string;
  /** The panel's heading, when a screen wants to say it differently. */
  label?: string;
}): React.ReactElement {
  const units = useUnits();

  // Wrapped so it closes over both the farm's units and the subject: a bare
  // module reference would read the whole farm, which is the bug this exists
  // to fix arriving through the back door.
  const read = useCallback(() => listHistory(units, { subject }), [units, subject]);
  const days = useLive(read, 'what happened here');

  if (days === null) return <Loading title={label} />;

  if (days.length === 0) {
    return (
      <Panel label={label}>
        <Body>Nothing logged against this yet. What you record will show up here.</Body>
      </Panel>
    );
  }

  return (
    <Panel label={label}>
      {days.slice(0, DAYS).map((day) => (
        <DayBlock key={day.day} day={day} />
      ))}
    </Panel>
  );
}

/** One day, its heading, and the rows under it. */
function DayBlock({ day }: { day: HistoryDay }): React.ReactElement {
  const { colors } = useTheme();

  return (
    <View style={styles.day}>
      <Text style={[styles.heading, { color: colors.muted }]}>
        {new Date(day.day).toLocaleDateString(undefined, {
          weekday: 'short',
          day: 'numeric',
          month: 'long',
        })}
      </Text>
      <DayEvents day={day} />
    </View>
  );
}

/**
 * The rows themselves, wherever they are being drawn.
 *
 * Extracted so the pane, the expanded day and a subject's timeline cannot
 * drift: taking a record back has to behave identically whichever container it
 * happens to be in, and copies of a list whose rows delete things are chances
 * to get exactly that wrong.
 */
export function DayEvents({ day }: { day: HistoryDay }): React.ReactElement {
  /**
   * Which row is showing its options, if any.
   *
   * Per day rather than per app, because only one day is open at a time — and
   * held here rather than in the row so that opening a second row shuts the
   * first. Two armed delete buttons on screen at once is how somebody taps the
   * wrong one.
   */
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <>
      {day.events.map((event) => (
        <EventRow
          key={event.id}
          event={event}
          selected={selected === event.id}
          onSelect={() => setSelected(selected === event.id ? null : event.id)}
        />
      ))}
    </>
  );
}

/**
 * One record, and the way back out of it.
 *
 * Every entity a history row can be built from is append-only, and every one
 * of them accepts a delete — a mistyped hour meter reading cannot be corrected
 * by recording a better one, because the meter's own rule refuses anything
 * lower, so taking it back is the whole of it. See `APPEND_ONLY_ENTITIES`.
 */
function EventRow({
  event,
  selected,
  onSelect,
}: {
  event: HistoryEvent;
  selected: boolean;
  onSelect: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const log = useLog();
  const removed = useSaver(useCallback(() => undefined, []));

  const remove = useCallback(() => {
    void removed.save(async () => {
      /**
       * Archived, never deleted (P13) — the row leaves every reader, the
       * record stays. Idempotent on the server, so a delete that syncs twice
       * archives once and the second is a no-op rather than an error.
       */
      await log({ entity: event.entity, op: 'delete', targetId: event.id, payload: {} });
      // No `onDone`: the reader drops the record on the next publish, so the
      // row unmounts itself. Nothing to navigate away from.
    });
  }, [removed, log, event.entity, event.id]);

  const when = new Date(event.at).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <View style={styles.record}>
      <Touch
        affordance="disclose"
        onPress={onSelect}
        accessibilityRole="button"
        accessibilityState={{ expanded: selected }}
        // The time is part of the sentence read aloud: "8:04. 12 eggs" is the
        // row, and the title alone cannot be told from the one below it.
        accessibilityLabel={`${when}. ${event.title}. ${
          selected ? 'Showing options.' : 'Tap for options.'
        }`}
        testID={`event-${event.id}`}
        style={({ pressed }) => [styles.event, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Text style={[styles.time, { color: colors.muted }]}>{when}</Text>
        <View style={styles.name}>
          <Text style={[styles.title, { color: colors.ink }]}>{event.title}</Text>
          {event.detail === undefined ? null : (
            <Text style={[styles.detail, { color: colors.muted }]}>{event.detail}</Text>
          )}
        </View>
        <Icon name={selected ? 'minus' : 'more'} size={16} color={colors.muted} />
      </Touch>

      {selected ? (
        <View style={styles.actions}>
          {/* What it costs, before the second tap rather than after it. A
              record leaving history takes its share of every total with it,
              and somebody expecting the line to merely be tidied away should
              find that out here. */}
          <Text style={[styles.detail, { color: colors.muted }]}>
            Logged in error? Take it back out — the day&rsquo;s totals and every average
            it counted towards will change to match.
          </Text>
          <Confirm
            label="Take this back"
            armedLabel="Tap again to remove it"
            onConfirm={remove}
            testID={`event-remove-${event.id}`}
          />
          <Failure message={removed.failure} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  day: { gap: SPACE.xs },
  record: { gap: SPACE.xs },
  // A row is a tap target, so it gets the height of one (R3).
  event: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    minHeight: TAP.min,
    paddingHorizontal: SPACE.md,
  },
  name: { flex: 1, gap: 2 },
  actions: { gap: SPACE.sm, paddingHorizontal: SPACE.md, paddingBottom: SPACE.sm },
  heading: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: { fontFamily: FONTS.body, fontSize: TYPE.body },
  detail: { fontFamily: FONTS.data, fontSize: TYPE.label },
  time: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    fontVariant: ['tabular-nums'],
    minWidth: 64,
  },
});
