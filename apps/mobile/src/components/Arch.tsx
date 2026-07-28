/**
 * The arch, drawn rather than styled.
 *
 * On the web the whole motif is one token:
 *
 *   --arch: 50% 50% 0.5rem 0.5rem / 2rem 2rem 0.5rem 0.5rem;
 *
 * Two radii per corner — half the width across, a fixed 32 down — which is
 * what gives a doorway a wide shallow head on straight jambs. React Native's
 * borderRadius is circular only and takes no second value, so there is no
 * style that can express this: at any width wider than it is tall a circular
 * radius either domes the whole top or flattens into a rounded rectangle, and
 * both were rejected on the web for the same reason.
 *
 * So the arch becomes a component. It draws the outline as one SVG path behind
 * its children and reports nothing about layout — put padding on the content,
 * not here. arch = something you can act on; a panel that only tells you
 * something wears no door.
 *
 * The path maths lives in `theme/arch.ts` rather than here, so the suite can
 * reach it: this file imports react-native and react-native-svg, neither of
 * which loads in Node, and the shape of the motif is exactly the part that
 * must not regress silently.
 */

import { useState } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { archPath } from '../theme/arch';
import { ARCH } from '../theme/tokens';

export interface ArchProps {
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  /** Vertical radius of the head. Lower it for chips, leave it for cards. */
  spring?: number;
  footRadius?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function Arch({
  fill,
  stroke,
  strokeWidth = 2,
  spring = ARCH.spring,
  footRadius = ARCH.foot,
  style,
  children,
}: ArchProps): React.ReactElement {
  const [size, setSize] = useState({ w: 0, h: 0 });

  const onLayout = (e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
  };

  const inset = strokeWidth / 2;

  return (
    <View style={style} onLayout={onLayout}>
      {size.w > 0 && size.h > 0 ? (
        <Svg
          width={size.w}
          height={size.h}
          style={{ position: 'absolute', left: 0, top: 0 }}
          pointerEvents="none"
        >
          <Path
            d={archPath(size.w - strokeWidth, size.h - strokeWidth, spring, footRadius)}
            x={inset}
            y={inset}
            fill={fill}
            {...(stroke === undefined ? {} : { stroke, strokeWidth })}
          />
        </Svg>
      ) : null}
      {children}
    </View>
  );
}
