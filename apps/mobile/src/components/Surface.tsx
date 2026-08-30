/**
 * A lit surface: the card face, painted rather than styled.
 *
 * ## What this replaces, and why the SVG stayed
 *
 * This was `<Arch>`. The motif — half the width across, a fixed 32 down — was
 * drawn because RN's `borderRadius` is circular only and cannot express two
 * radii per corner. The arch is gone; the drawing is not.
 *
 * The glow is the reason. It is a radial gradient, RN has none outside SVG,
 * and it must stop where the card does. `Arch.tsx` argued that a second
 * absolutely-positioned gradient layer would be two elements to keep in step
 * with light spilling past the edge, and that argument does not depend on the
 * shape underneath it. So the path became a rounded rectangle and everything
 * around it stayed: one `<Svg>` fills the face and clips the light to the same
 * outline.
 *
 * ## The glow is on every surface now, and that reverses a rule
 *
 * UX-SPEC §2 rationed gradients to one — *"no gradients beyond the single lamp
 * glow"* — and `Arch.tsx` gave the reason: a door with light behind it reads as
 * somewhere to go, and four of them read as a gradient habit. The farmer asked
 * for the light on every card, which is a decision about their own interface,
 * and §2 has been rewritten to say so rather than left contradicting the code.
 *
 * What survives of the old restraint is scale. The glow token carries its own
 * alpha per theme and this takes the colour rather than deciding an opacity, so
 * the Tally is still the brightest thing on any screen — it is simply the
 * largest surface, and the same wash over a bigger head reads as more light.
 */

import { useId, useState } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { ClipPath, Defs, Ellipse, Path, RadialGradient, Stop } from 'react-native-svg';
import { cardPath } from '../theme/surface';
import { SURFACE } from '../theme/tokens';

export interface SurfaceProps {
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  /** Corner radius. Lower it for chips, leave it for cards. */
  radius?: number;
  /**
   * Lamplight across the head of the card, as the theme's `glow` token.
   *
   * The token already carries its own alpha per theme — 22% in daylight, 30%
   * in lamplight, 16% in bright sun — so this takes the colour and fades it to
   * transparent rather than deciding an opacity of its own. That is what keeps
   * it brightest at 5am and faintest at noon without this knowing which.
   */
  glow?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function Surface({
  fill,
  stroke,
  strokeWidth = 2,
  radius = SURFACE.radius,
  glow,
  style,
  children,
}: SurfaceProps): React.ReactElement {
  const [size, setSize] = useState({ w: 0, h: 0 });

  /**
   * SVG ids are document-global even inside separate `<Svg>` elements, so two
   * cards on one screen would share whichever gradient rendered last — which
   * now means every card on every screen, rather than the one Tally that used
   * to be the only holder of a gradient. `useId` is what React provides for
   * exactly this and is stable across re-renders.
   */
  const id = useId().replace(/:/g, '');

  const onLayout = (e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
  };

  const inset = strokeWidth / 2;
  const d = cardPath(size.w - strokeWidth, size.h - strokeWidth, radius);

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
              <ClipPath id={`face-${id}`}>
                <Path d={d} x={inset} y={inset} />
              </ClipPath>
            </Defs>
          )}

          <Path d={d} x={inset} y={inset} fill={fill} />

          {/**
           * High and wider than it is tall, so the light gathers along the top
           * edge rather than washing the whole face. With the arched head gone
           * there is no curve for it to come through, so what it has to read as
           * now is a lamp above the card — which means it must stay at the top
           * and must not reach the bottom edge, or the card looks lit from
           * inside and the ink sits in haze.
           */}
          {glow === undefined ? null : (
            <Ellipse
              cx={size.w / 2}
              cy={SURFACE.glowHead * 0.35}
              rx={size.w * 0.62}
              ry={SURFACE.glowHead * 1.9}
              fill={`url(#glow-${id})`}
              clipPath={`url(#face-${id})`}
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
