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
 *
 * ## The glow is inside the arch, not a layer over it
 *
 * The lamp glow is a `radial-gradient` on the web and RN has neither radial
 * gradients nor percentage transforms, so the obvious port is a second
 * absolutely-positioned view with a gradient image in it. That would be two
 * layers to keep in step, and the top one would spill past the arched head —
 * a rectangle of light with a doorway drawn inside it.
 *
 * It belongs in the SVG that is already here, clipped by the same path that
 * draws the door. One element, and the light stops where the wall does.
 */

import { useId, useState } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { ClipPath, Defs, Ellipse, Path, RadialGradient, Stop } from 'react-native-svg';
import { archPath } from '../theme/arch';
import { ARCH } from '../theme/tokens';

export interface ArchProps {
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  /** Vertical radius of the head. Lower it for chips, leave it for cards. */
  spring?: number;
  footRadius?: number;
  /**
   * Lamplight spilling through the head, as the theme's `glow` token.
   *
   * Absent on almost everything, which is the point: the spec allows exactly
   * one gradient in the whole interface and this is it (UX-SPEC §2). A door
   * with light behind it reads as somewhere to go; four of them read as a
   * gradient habit.
   *
   * The token already carries its own alpha per theme — 22% in daylight, 30%
   * in lamplight, 16% in bright sun — so this takes the colour and fades it to
   * transparent rather than deciding an opacity of its own.
   */
  glow?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function Arch({
  fill,
  stroke,
  strokeWidth = 2,
  spring = ARCH.spring,
  footRadius = ARCH.foot,
  glow,
  style,
  children,
}: ArchProps): React.ReactElement {
  const [size, setSize] = useState({ w: 0, h: 0 });

  /**
   * SVG ids are document-global even inside separate `<Svg>` elements, so two
   * arches on one screen would share whichever gradient rendered last. `useId`
   * is what React provides for exactly this and is stable across re-renders.
   */
  const id = useId().replace(/:/g, '');

  const onLayout = (e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
  };

  const inset = strokeWidth / 2;
  const d = archPath(size.w - strokeWidth, size.h - strokeWidth, spring, footRadius);

  return (
    <View style={style} onLayout={onLayout}>
      {size.w > 0 && size.h > 0 ? (
        <Svg
          width={size.w}
          height={size.h}
          style={{ position: 'absolute', left: 0, top: 0 }}
          pointerEvents="none"
        >
          {glow === undefined ? null : (
            <Defs>
              <RadialGradient id={`glow-${id}`}>
                <Stop offset="0" stopColor={glow} />
                {/* Same hue, no alpha. A stop that changed colour as well as
                    opacity would fade brass through grey on the way out. */}
                <Stop offset="1" stopColor={glow} stopOpacity="0" />
              </RadialGradient>
              <ClipPath id={`door-${id}`}>
                <Path d={d} x={inset} y={inset} />
              </ClipPath>
            </Defs>
          )}

          <Path d={d} x={inset} y={inset} fill={fill} />

          {/**
           * Above the spring line and wider than it is tall, so the light
           * gathers in the head rather than washing the whole face — which is
           * what makes it read as coming through the doorway instead of from
           * the card itself.
           */}
          {glow === undefined ? null : (
            <Ellipse
              cx={size.w / 2}
              cy={spring * 0.35}
              rx={size.w * 0.62}
              ry={spring * 1.9}
              fill={`url(#glow-${id})`}
              clipPath={`url(#door-${id})`}
            />
          )}

          {/* The outline last, so the glow cannot wash out the edge it is
              supposed to be lighting. */}
          {stroke === undefined ? null : (
            <Path d={d} x={inset} y={inset} fill="none" stroke={stroke} strokeWidth={strokeWidth} />
          )}
        </Svg>
      ) : null}
      {children}
    </View>
  );
}
