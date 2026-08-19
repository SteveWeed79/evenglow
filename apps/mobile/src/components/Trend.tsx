import { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import type { Point } from '@homefarm/core/read/trend';
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
 */

export function Trend({
  points,
  /** "eggs", "ml", "lb" — said once, under the total rather than on an axis. */
  unit,
  /** Turns a stored amount into what a person reads. Grams to pounds, say. */
  format = (amount) => String(amount),
  testID,
}: {
  points: readonly Point[];
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
            // The bucket in progress, which is always short because it is not
            // over. Drawn hollow so nobody reads it as a fall.
            const partial = index === points.length - 1;

            return (
              <Rect
                key={point.at}
                x={index * (bar + gap)}
                y={height - tall}
                width={bar}
                height={tall}
                rx={2}
                fill={partial ? colors.shade : colors.lantern}
                stroke={partial ? colors.lantern : 'none'}
                strokeWidth={partial ? 1 : 0}
              />
            );
          })}
        </Svg>
      )}

      <View style={styles.scale}>
        <Text style={[styles.tick, { color: colors.muted }]}>
          {format(most)} {unit}
        </Text>
        <Text style={[styles.tick, { color: colors.muted }]}>this week</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { gap: SPACE.xs },
  scale: { flexDirection: 'row', justifyContent: 'space-between' },
  tick: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.4 },
});
