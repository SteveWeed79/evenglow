import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type HistoryDay, type HistoryEvent, listHistory } from '@steading/core/read/history';
import { Confirm, Failure, useSaver } from '../components/Form';
import { Icon } from '../components/Icon';
import { Loading } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Touch } from '../components/Touch';
import { useLive } from '../hooks/useLive';
import { useLog } from '../hooks/useSync';
import { useUnits } from '../hooks/useUnits';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TAP, TYPE } from '../theme/tokens';

/**
 * What happened, and when.
 *
 * ## The shape, and why it is this one
 *
 * A farm's records were write-only. Everything went in and the only way back
 * out was the screen that happened to summarise it — today's tally, this
 * group's last feed. "What did we do last Tuesday" had no answer at all.
 *
 * Days, closed, each reading as one line: **"12 eggs · 2 feeds · 1 loss"**.
 * That is the format that survives a farm with two years of records, because
 * scrolling a year of individual rows is not reading, it is hunting. The
 * detail is behind the day rather than absent from it — one tap, in place, no
 * screen change, because the rows under a day are the same kind of thing as
 * the line that summarises them.
 *
 * The newest day opens itself. It is the one being asked about nine times in
 * ten, and a screen that opens with everything shut asks for a tap before it
 * says anything at all.
 *
 * ## Derived, like everything else here
 *
 * There is no history table — see `read/history.ts`. This renders the same
 * append-only records the tallies and the due engine work from, so it cannot
 * disagree with them, and it works with the radio off like every other screen.
 *
 * ## Why days are capped
 *
 * A `ScrollView` renders every child it is given. Two years is roughly seven
 * hundred day headers, and mounting all of them to show the top four is how a
 * screen takes a second to open on a mid-range handset. Thirty is about six
 * weeks of looking back, which covers the question people actually ask.
 *
 * ## And it is where a mistake gets taken back
 *
 * Twelve eggs against the wrong flock, a feed logged twice, a weight typed
 * with a digit too many. This is the only screen that shows the individual
 * record, so it is the only place a person can point at the wrong one — every
 * other screen shows the total it landed in. Tap a row, take it back.
 *
 * `read/history.ts` filters removed records like every other reader, so the
 * row goes and the day's readout above it re-adds without it.
 */

const VISIBLE_DAYS = 30;

export function HistoryScreen(): React.ReactElement {
  const units = useUnits();
  // Wrapped rather than module-level because it now closes over the farm's
  // units — `useLive` resubscribes on an unstable read, so an inline arrow
  // would re-read on every frame.
  const readHistory = useCallback((): Promise<HistoryDay[]> => listHistory(units), [units]);

  const days = useLive(readHistory, 'what you have logged');
  const { colors } = useTheme();

  const [showAll, setShowAll] = useState(false);
  // `undefined` means "nobody has chosen yet", which is what lets the newest
  // day open itself without that decision surviving a deliberate close.
  const [opened, setOpened] = useState<number | undefined>(undefined);

  if (days === null) return <Loading title="What happened" />;

  if (days.length === 0) {
    return (
      <Screen title="What happened">
        <Panel label="Nothing logged yet">
          {/* Empty screens invite (UX-SPEC §6). */}
          <View style={styles.spot}>
          </View>
          <Body>
            Every tally, feed, treatment and loss you record lands here, oldest kept for as long
            as you keep the app. Log something today and this fills itself in.
          </Body>
        </Panel>
      </Screen>
    );
  }

  const shown = showAll ? days : days.slice(0, VISIBLE_DAYS);
  const open = opened ?? days[0]?.day;

  return (
    <Screen title="What happened">
      {shown.map((day) => (
        <DayBlock
          key={day.day}
          day={day}
          open={open === day.day}
          // Tapping the open one shuts it; tapping any other moves the opening.
          onToggle={() => setOpened(open === day.day ? -1 : day.day)}
        />
      ))}

      {days.length > shown.length ? (
        <Touch affordance="disclose"
          onPress={() => setShowAll(true)}
          accessibilityRole="button"
          testID="show-all-days"
          style={({ pressed }) => [styles.more, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[styles.moreLabel, { color: colors.muted }]}>
            Show all {days.length} days
          </Text>
        </Touch>
      ) : null}
    </Screen>
  );
}

function DayBlock({
  day,
  open,
  onToggle,
}: {
  day: HistoryDay;
  open: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const { colors } = useTheme();

  /**
   * Which row is showing its options, if any.
   *
   * Per day rather than per app, because only one day is open at a time — and
   * held here rather than in the row so that opening a second row shuts the
   * first. Two armed delete buttons on screen at once is how somebody taps the
   * wrong one.
   */
  const [selected, setSelected] = useState<string | null>(null);

  const heading = new Date(day.day).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <View style={styles.day}>
      <Touch affordance="disclose"
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        // Said in full: "12 eggs" read aloud without its date means nothing.
        accessibilityLabel={`${heading}. ${day.summary}.`}
        testID={`day-${day.day}`}
        style={({ pressed }) => [
          styles.head,
          {
            backgroundColor: colors.raised,
            borderColor: open ? colors.lanternInk : colors.border,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <View style={styles.name}>
          <Text style={[styles.heading, { color: colors.ink }]}>{heading}</Text>
          {/* The readout, and the whole reason a closed day is worth having. */}
          <Text style={[styles.label, { color: colors.muted }]}>{day.summary}</Text>
        </View>

        <Icon name={open ? 'minus' : 'plus'} size={20} color={colors.muted} />
      </Touch>

      {open
        ? day.events.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              selected={selected === event.id}
              onSelect={() => setSelected(selected === event.id ? null : event.id)}
            />
          ))
        : null}
    </View>
  );
}

/**
 * One record, and the way back out of it.
 *
 * The row is the control — the same shape as a note. Tapping shows what can be
 * done with it rather than doing anything, because a list where a tap on the
 * wrong line destroys a record is a list nobody scrolls with gloves on.
 *
 * **Taking one back removes the record, it does not edit it.** These are
 * append-only observations: what a record says never changes, which is what
 * lets two devices hold the same one without arguing about it. Correcting a
 * count is removing the wrong record and logging the right one, and that is
 * the whole of it — see `APPEND_ONLY_ENTITIES` in contracts.
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
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    minHeight: TAP.min,
    padding: SPACE.md,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
  },
  name: { flex: 1, gap: 2 },
  record: { gap: SPACE.xs },
  // A row is a tap target now, so it gets the height of one (R3).
  event: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    minHeight: TAP.min,
    paddingHorizontal: SPACE.md,
  },
  actions: { gap: SPACE.sm, paddingHorizontal: SPACE.md, paddingBottom: SPACE.sm },
  spot: { alignItems: 'center', paddingVertical: SPACE.md },
  more: { alignSelf: 'flex-start', paddingVertical: SPACE.xs, paddingHorizontal: SPACE.sm },
  heading: { fontFamily: FONTS.display, fontSize: TYPE.title },
  title: { fontFamily: FONTS.body, fontSize: TYPE.body },
  detail: { fontFamily: FONTS.data, fontSize: TYPE.label },
  time: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    fontVariant: ['tabular-nums'],
    minWidth: 64,
  },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  moreLabel: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
