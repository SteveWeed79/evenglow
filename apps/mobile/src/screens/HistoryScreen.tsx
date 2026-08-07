import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type HistoryDay, listHistory } from '@steading/core/read/history';
import { Icon } from '../components/Icon';
import { Loading } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Touch } from '../components/Touch';
import { useLive } from '../hooks/useLive';
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
            <Icon name="season" size={56} color={colors.muted} />
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
            <View key={event.id} style={styles.event}>
              <Text style={[styles.time, { color: colors.muted }]}>
                {new Date(event.at).toLocaleTimeString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Text>
              <View style={styles.name}>
                <Text style={[styles.title, { color: colors.ink }]}>{event.title}</Text>
                {event.detail === undefined ? null : (
                  <Text style={[styles.detail, { color: colors.muted }]}>{event.detail}</Text>
                )}
              </View>
            </View>
          ))
        : null}
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
  event: { flexDirection: 'row', gap: SPACE.md, paddingHorizontal: SPACE.md },
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
