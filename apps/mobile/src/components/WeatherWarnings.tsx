import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Warning } from '@steading/contracts';
import { Touch } from './Touch';
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
 * No modal, no confirm, **and nothing to dismiss**. That last one was asked for
 * directly, from a handset showing two heat warnings filling the screen, and
 * the answer is no for four reasons worth keeping:
 *
 *  - It is a safety surface. Agreeing to be silent about 96°F because somebody
 *    tapped at 8:52am is the app being wrong at three in the afternoon.
 *  - Dismissal needs storage, and both options are bad. Device-local means a
 *    second phone still nags and a reinstall forgets; synced means a new
 *    mutable entity for something derived that expires in a day.
 *  - It is the completion flag the due engine refuses (property 3) wearing
 *    another name — a stored "I saw this" that drifts from what it describes.
 *  - Dismissible warnings train the reflex, and the frost row in May gets
 *    tapped away by the same thumb.
 *
 * **What was actually wrong was that the same warning was drawn twice.** Today
 * and tomorrow were built independently, so one hot spell became two four-line
 * rows saying the same thing in different tenses, and the egg tally went below
 * the fold — which is exactly the failure `TodayScreen` already records about
 * the due list. Identical warnings now fold into one row that names both days,
 * and the strip is capped like the due bundles beside it.
 */

/**
 * How many rows before it offers the rest.
 *
 * Three, because that is the worst honest case on one night — a freeze, a
 * frost, and a birth due — and a farm hitting all three should see all three.
 * Past that is a screen nobody reads to the bottom of, and the tally that
 * matters every single morning is below it.
 */
const VISIBLE_WARNINGS = 3;

export function WeatherWarnings(): React.ReactElement | null {
  const { warnings } = useWarnings();
  const { colors } = useTheme();
  const [showAll, setShowAll] = useState(false);

  // Nothing to say, so nothing is drawn — not an empty panel with a heading.
  if (warnings.length === 0) return null;

  const shown = showAll ? warnings : warnings.slice(0, VISIBLE_WARNINGS);

  return (
    <View style={styles.strip} testID="weather-warnings">
      {shown.map((warning) => (
        <WarningRow key={warning.key} warning={warning} />
      ))}

      {warnings.length > shown.length ? (
        <Touch affordance="disclose"
          onPress={() => setShowAll(true)}
          accessibilityRole="button"
          // Said in full: "+2" read aloud on its own means nothing, and the
          // count is the part that decides whether it is worth the tap.
          accessibilityLabel={`Show ${warnings.length - shown.length} more warnings`}
          testID="show-all-warnings"
          hitSlop={8}
          style={({ pressed }) => [styles.more, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[styles.moreLabel, { color: colors.muted }]}>
            and {warnings.length - shown.length} more
          </Text>
        </Touch>
      ) : null}
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
  more: { alignSelf: 'flex-start', paddingVertical: SPACE.xs, paddingHorizontal: SPACE.sm },
  moreLabel: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  words: { flex: 1, gap: 2 },
  title: { fontFamily: FONTS.bodyBold, fontSize: TYPE.body, lineHeight: TYPE.body * 1.35 },
  detail: { fontFamily: FONTS.body, fontSize: TYPE.body - 1, lineHeight: TYPE.body * 1.3 },
});
