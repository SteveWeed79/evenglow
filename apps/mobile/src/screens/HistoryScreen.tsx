import { useCallback, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import {
  intoMonths,
  type HistoryDay,
  type HistoryMonth,
  listHistory,
} from '@homefarm/core/read/history';
import { Icon } from '../components/Icon';
import { DayEvents } from '../components/Timeline';
import { Loading } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Touch } from '../components/Touch';
import { useLive } from '../hooks/useLive';
import { useWindow } from '../hooks/useWindow';
import { useUnits } from '../hooks/useUnits';
import { useReveal } from '../theme/motion';
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

export function HistoryScreen(): React.ReactElement {
  const units = useUnits();
  // Wrapped rather than module-level because it now closes over the farm's
  // units — `useLive` resubscribes on an unstable read, so an inline arrow
  // would re-read on every frame.
  const readHistory = useCallback((): Promise<HistoryDay[]> => listHistory(units), [units]);

  const days = useLive(readHistory, 'what you have logged');
  /**
   * `bar: true`, because this is a tab screen and above the expanded boundary
   * its tab bar is a rail taking 96dp off the side.
   *
   * Without it this asked a different question than the `Screen` it hands the
   * aside to — `Screen` uses `{ bar: !back }` — and the two disagreed across
   * that 96dp band: a window wide enough for two panes *before* the rail is
   * taken off and not after. In the band this screen believed it was split, so
   * it stopped opening days inline and dropped the plus/minus that says a row
   * expands, while `Screen` restacked the pane under the list — leaving a day
   * that could only be read by scrolling past every month to the bottom of the
   * screen. `TodayScreen` found the same bug in the same shape and its comment
   * is worth repeating: nothing on this farm's hardware sits in the band,
   * which is exactly why it would have waited for a device that does.
   */
  const { panes } = useWindow({ bar: true });

  /**
   * `undefined` means "nobody has chosen yet", which is what lets the newest
   * month and the newest day open themselves without that decision surviving a
   * deliberate close.
   *
   * The thirty-day cap and its "show all" button are gone, and the months are
   * why rather than an oversight: the cap existed because a flat list of days
   * grew without bound, and a list of months does not. Nothing is hidden that
   * was reachable before — every day is still there, one heading further in,
   * and the button that used to make the list *longer* is not the fix for a
   * list too long to read.
   */
  const [opened, setOpened] = useState<number | undefined>(undefined);
  const [month, setMonth] = useState<number | undefined>(undefined);

  if (days === null) return <Loading title="What happened" />;

  if (days.length === 0) {
    return (
      <Screen title="What happened">
        <Panel label="Nothing logged yet">
          {/* Empty screens invite (UX-SPEC §6). */}
          <Body>
            Every tally, feed, treatment and loss you record lands here, oldest kept for as long
            as you keep the app. Log something today and this fills itself in.
          </Body>
        </Panel>
      </Screen>
    );
  }

  const months = intoMonths(days, units);
  const open = opened ?? days[0]?.day;
  const openMonth = month ?? months[0]?.month;

  /**
   * The list-detail pilot, and this screen was chosen for it because it is
   * already list-detail wearing a phone's clothes.
   *
   * Days collapse to one line — "12 eggs · 2 feeds · 1 loss" — and expand **in
   * place**, which the header above explains as the right call for a phone: no
   * screen change, because the rows under a day are the same kind of thing as
   * the line that summarises them. That reasoning holds and it runs out at
   * 992dp, where expanding in place means a 600dp list pushing itself down the
   * screen while a whole column sits empty beside it.
   *
   * Nothing here is a new component and nothing moves route. The same rows
   * render in the same order; only which container they land in changes.
   */
  const split = panes === 2;
  const openDay = days.find((day) => day.day === open) ?? null;

  return (
    <Screen
      title="What happened"
      {...(split && openDay !== null ? { aside: <DayRecords day={openDay} /> } : {})}
    >
      {months.map((entry) => (
        <MonthBlock
          key={entry.month}
          month={entry}
          open={openMonth === entry.month}
          onToggle={() => setMonth(openMonth === entry.month ? -1 : entry.month)}
          openDay={open}
          /**
           * Beside the list, a day is *selected* rather than *expanded*, so
           * tapping the open one does nothing instead of closing it. An empty
           * detail pane is a dead half-screen, and the second tap that
           * produces one is a mistake somebody makes once and then distrusts
           * the row for.
           */
          onToggleDay={(day) => setOpened(split ? day : open === day ? -1 : day)}
          inline={!split}
        />
      ))}
    </Screen>
  );
}

/**
 * One day's records, for the pane beside the list.
 *
 * The heading is repeated here on purpose. The row that selected this day is
 * one of thirty in the other column and may well have been scrolled past, so a
 * pane that opened with "18 eggs, 06:42" and no date would be a list of
 * numbers about nothing — the same argument the accessibility label on the day
 * head already makes.
 */
function DayRecords({ day }: { day: HistoryDay }): React.ReactElement {
  const { colors } = useTheme();

  return (
    <View style={styles.day}>
      <Text style={[styles.heading, { color: colors.ink }]}>
        {new Date(day.day).toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
      </Text>
      <DayEvents day={day} />
    </View>
  );
}

/**
 * A month, and the days in it.
 *
 * Closed it is one line — the month, how many days had something, and what came
 * off the farm in it. Open it is the day list this screen has always shown.
 *
 * The newest month opens itself for the same reason the newest day does: the
 * commonest visit is "what did I do yesterday", and making that a two-tap
 * journey to save a one-line heading would be the wrong trade.
 */
function MonthBlock({
  month,
  open,
  onToggle,
  openDay,
  onToggleDay,
  inline,
}: {
  month: HistoryMonth;
  open: boolean;
  onToggle: () => void;
  openDay: number | undefined;
  onToggleDay: (day: number) => void;
  /** Whether a day opens under itself, or beside the list. See `DayRecords`. */
  inline: boolean;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <View style={styles.month}>
      <Touch affordance="disclose"
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID={`month-${month.month}`}
        style={({ pressed }) => [
          styles.monthHead,
          { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[styles.monthName, { color: colors.ink }]}>
          {new Date(month.month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </Text>
        <Text style={[styles.monthSummary, { color: colors.muted }]}>
          {month.active} {month.active === 1 ? 'day' : 'days'} · {month.summary}
        </Text>
      </Touch>

      {!open
        ? null
        : month.days.map((day) => (
            <DayBlock
              key={day.day}
              day={day}
              open={openDay === day.day}
              // Tapping the open one shuts it; tapping any other moves the opening.
              onToggle={() => onToggleDay(day.day)}
              inline={inline}
            />
          ))}
    </View>
  );
}

function DayBlock({
  day,
  open,
  onToggle,
  inline,
}: {
  day: HistoryDay;
  open: boolean;
  onToggle: () => void;
  inline: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  const reveal = useReveal();

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

        {/**
          * The mark promises what pressing does, so it only appears when
          * pressing expands something.
          *
          * Beside a detail pane the row selects rather than opens, and a plus
          * that turned into a minus while the rows stayed put in the other
          * column would be the affordance lying about the act — the same rule
          * `Row`'s `mark` prop exists for. Selection is said by the brass
          * border and by the pane changing.
          */}
        {inline ? <Icon name={open ? 'minus' : 'plus'} size={20} color={colors.muted} /> : null}
      </Touch>

      {/* The rows settle in rather than appearing whole. The day's height
          still changes in one frame; see `useReveal` for why that is the half
          worth leaving alone. */}
      {inline && open ? (
        <Animated.View style={[styles.events, reveal]}>
          <DayEvents day={day} />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  day: { gap: SPACE.xs },
  // The rows used to be direct children of `day` and inherited its gap. They
  // sit in a wrapper now so they can be animated as one, so it repeats here —
  // the wrapper keeps `day`'s gap to the header above it.
  events: { gap: SPACE.xs },
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
  /**
   * The month, and the days indented under it.
   *
   * A small inset rather than a border or a background: the day blocks already
   * carry one each, and nesting two framed things is how a list stops reading
   * as a list. The gap is what says these belong to the heading above them.
   */
  month: { gap: SPACE.sm },
  monthHead: {
    gap: 2,
    minHeight: TAP.min,
    justifyContent: 'center',
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  monthName: { fontFamily: FONTS.display, fontSize: TYPE.title },
  monthSummary: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.4 },
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
