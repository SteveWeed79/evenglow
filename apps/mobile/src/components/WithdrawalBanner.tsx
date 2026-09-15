import { StyleSheet, Text, View } from 'react-native';
import {
  type ActiveWithdrawal,
  NOT_VETERINARY_ADVICE,
  withdrawalMessage,
} from '@homefarm/contracts';
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
      <View style={styles.stack}>
        <Text style={[styles.words, { color: colors.ink }]}>{withdrawalMessage(withdrawal)}</Text>
        {/**
          * Where the number came from, under the number — `[16]`.
          *
          * **Here rather than only in Settings**, because this is the screen
          * somebody is on when they decide whether to sell. A disclaimer filed
          * under Settings is one nobody reads at the moment it applies, and
          * that moment is this one.
          *
          * `inkQuiet` rather than `muted`: this is a sentence, and
          * `contrast.test.ts` says in so many words that `muted` is for
          * "labels, units, dividers, timestamps — never a sentence". It is
          * also the tier held to the same 7:1 as `ink`, which matters on a
          * tinted band that the suite did not cover until this line existed.
          *
          * It does not compete with the message above it. The withheld line
          * leads at body size in `ink`; this follows, quieter and smaller,
          * which is the ordering the type scale already uses for a hint.
          */}
        <Text style={[styles.advice, { color: colors.inkQuiet }]}>{NOT_VETERINARY_ADVICE}</Text>
      </View>
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
  /** The two lines, so the band's own row layout stays about the band. */
  stack: { flex: 1, gap: SPACE.xs },
  words: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.35 },
  advice: {
    fontFamily: FONTS.body,
    fontSize: TYPE.body - 2,
    lineHeight: (TYPE.body - 2) * 1.35,
  },
});
