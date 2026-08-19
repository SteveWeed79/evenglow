import { StyleSheet, Text, View } from 'react-native';
import { type ActiveWithdrawal, withdrawalMessage } from '@homefarm/contracts';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TYPE } from '../theme/tokens';

/**
 * The one place a warning outranks speed (UX-SPEC §3).
 *
 * A band, not a modal (R10). It stays put, it does not interrupt, and it does
 * not block the rest of the screen — but committing a log while it is showing
 * takes one deliberate confirm tap, which the Tally handles.
 *
 * `alertTint` rather than a red fill: this must be noticed and must not be
 * alarming enough to be dismissed on sight. A farm hand who sees red all
 * morning learns to ignore red, and then misses the morning it means
 * something.
 */
export function WithdrawalBanner({
  withdrawal,
}: {
  withdrawal: ActiveWithdrawal;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <View
      style={[styles.band, { backgroundColor: colors.alertTint, borderColor: colors.rowan }]}
      accessibilityRole="alert"
    >
      <Text style={[styles.words, { color: colors.ink }]}>{withdrawalMessage(withdrawal)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    padding: SPACE.md,
    borderRadius: RADII.softHead,
    // A left rule rather than a full border: it marks the band without boxing
    // it, so it reads as part of the group rather than as a separate alert.
    borderLeftWidth: 4,
  },
  words: { flex: 1, fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.35 },
});
