import { StyleSheet, Text, View } from 'react-native';
import { readExposure } from '@steading/core/backup/exposure';
import { Icon } from './Icon';
import { Touch } from './Touch';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TAP, TYPE } from '../theme/tokens';

/**
 * The third moment in A2.3, which was never built.
 *
 * *"An account is asked for at three moments and no others… A second device. A
 * farm hand. Enough data to hurt losing."* The first two happen when somebody
 * goes looking. The third does not: nobody wakes up wanting recovery, they
 * want it the morning after they needed it.
 *
 * What stood in for it was one row in Settings reading "Everything is on this
 * phone only". True on day one about four records, true in year two about two
 * thousand, and therefore read as furniture by the time it means anything.
 *
 * ## Not a nag, and the difference is testable
 *
 * A2.3 forbids a timer, a nag and a modal. This is none of the three:
 *
 * - **Not a timer.** It is silent until the farm actually has something to
 *   lose (`EXPOSED_AT`), and silent forever on a farm that syncs.
 * - **Not a nag**, because a nag is a thing you cannot answer. This has two
 *   answers and both genuinely end it: sync, or take a copy.
 * - **Not a modal.** It informs and blocks nothing (R10). It sits below the
 *   weather warnings, because a meteorologist saying a tornado is on the
 *   ground outranks this app's opinion about filing, and above the tallies,
 *   because below them is where things go to be scrolled past.
 *
 * ## Nothing to dismiss, on purpose
 *
 * `WeatherWarnings` sets out why a dismiss button is the wrong answer, and
 * three of its four arguments hold here word for word — a stored "I saw this"
 * is the completion flag the due engine refuses, it drifts from what it
 * describes, and the reflex it trains gets spent on the row that mattered.
 *
 * The fourth argument is what makes this one different rather than exempt: a
 * weather warning has nothing you can do about it, so dismissal is the only
 * thing on offer. Here there are two real actions, and doing either takes the
 * strip away without anybody having to agree to be lied to.
 */

const NEVER_DRAWN = { exposed: false, records: 0, lastBackupAt: null, everSynced: false };

export function ExposureNotice(): React.ReactElement | null {
  const { colors } = useTheme();
  const nav = useNav();

  /**
   * `useLive`, so it goes away the moment it stops being true.
   *
   * Taking a copy and coming back to a screen still saying the records are in
   * one place would be the app arguing with something it just watched somebody
   * do.
   */
  const exposure = useLive(readExposure) ?? NEVER_DRAWN;

  // Nothing to say, so nothing is drawn — not an empty panel with a heading.
  if (!exposure.exposed) return null;

  return (
    <Touch
      affordance="chevron"
      onPress={() => nav.navigate('Backup')}
      accessibilityRole="button"
      accessibilityLabel={`${exposure.records} records are on this phone only. Open a copy of your farm.`}
      testID="exposure-notice"
      style={({ pressed }) => [
        styles.band,
        {
          backgroundColor: colors.alertTint,
          borderColor: colors.rowan,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={styles.words}>
        {/* The number first, because it is what makes an abstract fact real.
            "Everything" is a word; 1,540 is a season. */}
        <Text style={[styles.head, { color: colors.ink }]}>
          {exposure.records.toLocaleString()} records, on this phone only
        </Text>
        <Text style={[styles.body, { color: colors.ink }]}>
          {exposure.lastBackupAt === null
            ? 'Nothing has been copied anywhere else. Take one now, or set up an account.'
            : 'The last copy you took is old enough to be worth replacing.'}
        </Text>
      </View>

      {/* Drawn, not merely declared. The audit reads declarations by design,
          so the honesty of `affordance="chevron"` rests entirely on the
          component drawing what it claims — see `Row`, which owns this mark
          for every list row in the app. */}
      <Icon name="forward" size={20} color={colors.muted} />
    </Touch>
  );
}

const styles = StyleSheet.create({
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    minHeight: TAP.min,
    padding: SPACE.md,
    borderRadius: RADII.softHead,
    // The same left rule the withdrawal band uses: it marks the strip without
    // boxing it, so it reads as part of the screen rather than as an alert
    // pasted on top of one.
    borderLeftWidth: 4,
  },
  words: { flex: 1, gap: 2 },
  head: { fontFamily: FONTS.display, fontSize: TYPE.body, fontVariant: ['tabular-nums'] },
  body: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.35 },
});
