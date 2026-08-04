import { StyleSheet, Text, View } from 'react-native';
import type { Warning, WarningKind } from '@steading/contracts';
import { Icon, type IconName } from './Icon';
import { useWarnings } from '../hooks/useWarnings';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TYPE } from '../theme/tokens';

/**
 * What the forecast means for this farm, on Today.
 *
 * ## Silent on an ordinary day, and that is the whole design
 *
 * There is nothing here most mornings. A strip that appears every day is one
 * nobody reads by the second week — and then it is not read on the morning it
 * matters, which is the only morning it exists for. Every threshold behind
 * these rows is the point where somebody would actually do something
 * differently; see `contracts/warnings.ts` for each number and its reason.
 *
 * ## Above the weather row, not below it
 *
 * The row says what the weather is. This says what to do about it, and that is
 * the more urgent of the two — a farm that reads *"Below freezing tonight,
 * waterers will ice over"* and nothing else has got everything it needed. The
 * forecast underneath is the detail.
 *
 * ## It informs, it does not interrupt (R10)
 *
 * No modal, no confirm, nothing to dismiss. A frost warning that has to be
 * tapped away is a frost warning somebody taps away at 6am without reading.
 * These sit on the wall and are gone tomorrow if the forecast changes.
 */

const MARKS: Record<WarningKind, IconName> = {
  frost: 'season',
  freeze: 'waterer',
  'heat-poultry': 'sky-clear',
  'heat-ruminant': 'sky-clear',
  'heat-camelid': 'sky-clear',
  'birth-cold': 'milestone',
};

export function WeatherWarnings(): React.ReactElement | null {
  const { warnings } = useWarnings();

  // Nothing to say, so nothing is drawn — not an empty panel with a heading.
  if (warnings.length === 0) return null;

  return (
    <View style={styles.strip} testID="weather-warnings">
      {warnings.map((warning) => (
        <WarningRow key={warning.key} warning={warning} />
      ))}
    </View>
  );
}

function WarningRow({ warning }: { warning: Warning }): React.ReactElement {
  const { colors } = useTheme();

  /**
   * Rowan for the ones that need doing now, brass for the ones to keep an eye
   * on. Two colours because two severities — and the app already spends rowan
   * on things that are wrong, so a watch-level row must not borrow it.
   */
  const edge = warning.severity === 'act' ? colors.rowan : colors.lanternInk;

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: warning.severity === 'act' ? colors.alertTint : colors.raised,
          borderColor: edge,
        },
      ]}
      testID={`warning-${warning.kind}`}
      accessible
      // Said as one sentence: a screen reader landing on the title alone gets
      // the alarm without the instruction.
      accessibilityLabel={`${warning.title} ${warning.detail}`}
    >
      <Icon name={MARKS[warning.kind]} size={24} color={edge} />
      <View style={styles.words}>
        <Text style={[styles.title, { color: colors.ink }]}>{warning.title}</Text>
        <Text style={[styles.detail, { color: colors.muted }]}>{warning.detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { gap: SPACE.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.md,
    padding: SPACE.md,
    borderRadius: RADII.softHead,
    // A full-weight border rather than a hairline: this is the one thing on
    // Today that is allowed to be louder than the tally.
    borderWidth: 1,
  },
  words: { flex: 1, gap: 2 },
  title: { fontFamily: FONTS.bodyBold, fontSize: TYPE.body, lineHeight: TYPE.body * 1.35 },
  detail: { fontFamily: FONTS.body, fontSize: TYPE.body - 1, lineHeight: TYPE.body * 1.3 },
});
