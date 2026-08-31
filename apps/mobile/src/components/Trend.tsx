import { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import type { Grain, Point } from '@homefarm/core/read/trend';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * A season, as bars.
 *
 * ## Why bars and why so few of them
 *
 * This is the first chart in the app, and the constraints are the ones every
 * other screen has: read at arm's length, in sunlight, by somebody wearing a
 * glove. That rules out most of what a charting library is for. There are no
 * tooltips — you cannot hover with a glove — no legend, no axis furniture, and
 * no line, because a line through weekly totals invites reading a slope
 * between two points that are not measurements of the same thing.
 *
 * Twelve bars is a season at a glance. More would be thinner than a fingertip
 * and say less.
 *
 * ## No charting library
 *
 * Drawn with `react-native-svg`, which the icon set already depends on. A
 * charting package would be a new dependency (see the style rules) earning its
 * place with pan, zoom, tooltips and animation — every one of which is a thing
 * this deliberately does not have.
 *
 * ## The words are the point, not the shape
 *
 * A shape tells somebody that something is happening; a sentence tells them
 * what. The caption comes from `direction` in the projection rather than being
 * inferred from pixels, and it compares the last COMPLETE bucket — the current
 * week is always low because it is not over, and a chart that announced a
 * collapse every Monday would not be read twice.
 *
 * ## The scale says what it is, and the axis says which bucket
 *
 * Both were wrong in a way that made the screen read as nonsense, reported off
 * the tablet as *the numbers screen makes no sense*.
 *
 * The figure on the left is the **tallest bucket in the window** — what the top
 * of the chart is worth. It was rendered as a bare "56 eggs" directly above a
 * caption reading *"6 eggs last time round"*, so two unrelated numbers sat one
 * line apart with nothing saying they measured different things: one the peak
 * of twelve weeks, the other the last complete week. A farmer reading that sees
 * a contradiction, and the honest fix is a word, not a number.
 *
 * The label on the right said **"this week" whatever the grain**, so the twelve
 * *month* chart announced its last column as a week. It is hardcoded no longer;
 * the grain comes in as a prop, because this component cannot infer it from
 * twelve points that look identical either way.
 */

export function Trend({
  points,
  /**
   * Which bucket the twelve columns are, so the axis can name the last one.
   *
   * Required rather than defaulted to `'week'`. A default is what the hardcoded
   * string effectively was, and it was wrong on exactly one of the two screens
   * that render this — the quiet half of a two-state bug, which is the half
   * that survives review.
   */
  grain,
  /** "eggs", "ml", "lb" — said once, under the total rather than on an axis. */
  unit,
  /** Turns a stored amount into what a person reads. Grams to pounds, say. */
  format = (amount) => String(amount),
  testID,
}: {
  points: readonly Point[];
  grain: Grain;
  unit: string;
  format?: (amount: number) => string;
  testID?: string;
}): React.ReactElement {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);

  const measure = (event: LayoutChangeEvent): void => {
    setWidth(event.nativeEvent.layout.width);
  };

  const most = Math.max(1, ...points.map((point) => point.amount));
  const height = 96;
  const gap = 4;
  const bar = points.length === 0 ? 0 : Math.max(2, (width - gap * (points.length - 1)) / points.length);

  return (
    <View style={styles.chart} onLayout={measure} testID={testID}>
      {width === 0 ? null : (
        <Svg width={width} height={height}>
          {points.map((point, index) => {
            /**
             * A floor of two pixels on anything above zero.
             *
             * A week with one egg in it must not be indistinguishable from a
             * week with none — those are different facts, and the second is
             * the one worth noticing.
             */
            const tall = point.amount === 0 ? 0 : Math.max(2, (point.amount / most) * height);
            // The bucket in progress, which is usually short because it is not
            // over. Marked out so nobody reads it as a fall.
            const partial = index === points.length - 1;

            return (
              <Rect
                key={point.at}
                x={index * (bar + gap)}
                y={height - tall}
                width={bar}
                height={tall}
                rx={2}
                /**
                 * **Dimmed brass, not `shade`.** The bucket in progress was
                 * filled with the bottom-edge shadow — darker than the card it
                 * sits on — so it registered as an outline with nothing in it.
                 * That is fine on a twelve-week chart, where it is one column
                 * among eleven filled ones, and it empties the screen on the
                 * twelve-month one: a farm with a month of records has *all* of
                 * its eggs in the current bucket, so every bar was either zero
                 * or hollow. Reported as the chart showing nothing while the
                 * caption said 88.
                 *
                 * The same brass at a third of its weight keeps the reading —
                 * this column is not finished — and gives the column a height
                 * somebody can actually see.
                 */
                fill={colors.lantern}
                fillOpacity={partial ? 0.35 : 1}
                stroke={partial ? colors.lantern : 'none'}
                strokeWidth={partial ? 1 : 0}
              />
            );
          })}
        </Svg>
      )}

      <View style={styles.scale}>
        {/* "most", because this is the top of the chart rather than a total —
            see the note above on the two numbers that read as a contradiction. */}
        <Text style={[styles.tick, { color: colors.muted }]}>
          most {format(most)} {unit}
        </Text>
        <Text style={[styles.tick, { color: colors.muted }]}>
          {grain === 'week' ? 'this week' : 'this month'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { gap: SPACE.xs },
  scale: { flexDirection: 'row', justifyContent: 'space-between' },
  tick: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.4 },
});
