import { StyleSheet, Text, View } from 'react-native';
import { type Due, type DueKind, dueDate, type Urgency, urgencyOf } from '@steading/contracts';
import { Icon, type IconName } from './Icon';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TYPE } from '../theme/tokens';

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

export function DueRow({ due, now }: { due: Due; now: number }): React.ReactElement {
  const { colors } = useTheme();
  const urgency = urgencyOf(due, now);
  const colour = tint(urgency, colors);

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: urgency === 'overdue' ? colors.alertTint : colors.raised,
          borderColor: colors.border,
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel={`${due.title}, ${when(due, now)}`}
    >
      <Icon name={MARKS[due.kind]} size={24} color={colour} />

      <View style={styles.words}>
        <Text style={[styles.title, { color: colors.ink }]}>{due.title}</Text>
        <Text style={[styles.when, { color: colour }]}>{when(due, now)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    padding: SPACE.md,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
  },
  words: { flex: 1, gap: 2 },
  title: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.3 },
  when: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.4 },
});
