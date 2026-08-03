import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { type Due, type DueKind, dueDate, type Urgency, urgencyOf } from '@steading/contracts';
import { Icon, type IconName } from './Icon';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TAP, TYPE } from '../theme/tokens';

/**
 * One row on Today.
 *
 * A card, not an arch: this tells you something, it is not a door. The arch is
 * reserved for what you act on, and a due row is read and then acted on
 * somewhere else.
 */

/** The mark for each kind. Every one exists in the set — check:icons proves it. */
const MARKS: Record<DueKind, IconName> = {
  withdrawal: 'withdrawal',
  service: 'service',
  storage: 'iron',
  'start-indoors': 'growing',
  sow: 'growing',
  transplant: 'growing',
  harvest: 'basket',
  birth: 'stock',
  hatch: 'egg',
  candle: 'egg',
  processing: 'meat',
  task: 'date-due',
};

const DAY_MS = 86_400_000;

/**
 * When it is due, in the words someone would use.
 *
 * Days, never a timestamp. Nobody standing in a yard needs to know a service
 * is due at 09:14 — they need to know it is Thursday, or that it was last
 * week and nobody noticed.
 */
function when(due: Due, now: number): string {
  const at = dueDate(due);
  if (at === null) {
    return due.atReading === null ? '' : `at ${due.atReading} hours`;
  }

  // Whole days from the start of today, so "tomorrow" does not become "today"
  // because it is late in the evening.
  const days = Math.round((at - now) / DAY_MS);

  if (days < -1) return `${Math.abs(days)} days ago`;
  if (days === -1) return 'yesterday';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

function tint(urgency: Urgency, colors: { rowan: string; lanternInk: string; muted: string }): string {
  switch (urgency) {
    case 'overdue':
      return colors.rowan;
    case 'now':
      return colors.lanternInk;
    default:
      // Damson would be the obvious third colour and is wrong here: it means
      // queued, and a due row is not queued work.
      return colors.muted;
  }
}

/**
 * `onPress` is optional, and a row without one is not a bug.
 *
 * A due row is read and then acted on somewhere else, and for most kinds this
 * app knows where that is. For the few it does not — a row about a subject
 * that has no screen of its own — the row still says the true thing and simply
 * does not pretend to be a door.
 */
export function DueRow({
  due,
  now,
  onPress,
  onDone,
}: {
  due: Due;
  now: number;
  onPress?: (() => void) | undefined;
  /**
   * Writes the record named by `due.done`, when there is one.
   *
   * Absent on every kind where one press could not stand in for the form —
   * see the note on `Due.done`. A row without it still opens its screen.
   */
  onDone?: (() => void) | undefined;
}): React.ReactElement {
  const { colors } = useTheme();
  const urgency = urgencyOf(due, now);
  const colour = tint(urgency, colors);

  /**
   * Armed, then written. Two taps on a small target beside a bigger one.
   *
   * A `careLog` is append-only: there is no undo, and a job recorded as done
   * that was not done is worse than one still on the list. The armed state is
   * also where the past-tense label goes — "Trimmed feet?" says exactly what
   * is about to be written, which "Done" never could.
   */
  const [armed, setArmed] = useState(false);

  const body = (
    <>
      <Icon name={MARKS[due.kind]} size={24} color={colour} />

      <View style={styles.words}>
        <Text style={[styles.title, { color: colors.ink }]}>{due.title}</Text>
        <Text style={[styles.when, { color: colour }]}>{when(due, now)}</Text>
      </View>

      {due.done === undefined || onDone === undefined ? null : (
        <Pressable
          onPress={() => {
            if (!armed) {
              setArmed(true);
              return;
            }
            setArmed(false);
            onDone();
          }}
          accessibilityRole="button"
          accessibilityLabel={armed ? `Confirm: ${due.done.label}` : `${due.title}: mark done`}
          hitSlop={8}
          testID={`due-done-${due.key}`}
          style={({ pressed }) => [
            styles.done,
            {
              backgroundColor: armed ? colors.lantern : 'transparent',
              borderColor: armed ? colors.lanternInk : colors.border,
              opacity: pressed ? 0.75 : 1,
            },
          ]}
        >
          <Icon name="check" size={16} color={armed ? '#241c14' : colors.muted} />
          <Text style={[styles.doneLabel, { color: armed ? '#241c14' : colors.muted }]}>
            {armed ? due.done.label : 'Done'}
          </Text>
        </Pressable>
      )}

      {onPress === undefined ? null : <Icon name="forward" size={20} color={colors.muted} />}
    </>
  );

  const fill = urgency === 'overdue' ? colors.alertTint : colors.raised;

  if (onPress === undefined) {
    return (
      <View
        style={[styles.row, { backgroundColor: fill, borderColor: colors.border }]}
        accessibilityRole="text"
        accessibilityLabel={`${due.title}, ${when(due, now)}`}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${due.title}, ${when(due, now)}`}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: fill, borderColor: colors.border, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    minHeight: TAP.min,
    padding: SPACE.md,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
  },
  words: { flex: 1, gap: 2 },
  done: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    paddingVertical: SPACE.xs,
    paddingHorizontal: SPACE.sm,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
  },
  doneLabel: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.4 },
  title: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.3 },
  when: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.4 },
});
