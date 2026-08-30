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
 * ## The glow is on every card, and only after dark
 *
 * UX-SPEC §2 rationed gradients to one — *"no gradients beyond the single lamp
 * glow"* — on the reasoning that a lit surface reads as somewhere to go and four
 * of them read as a gradient habit. That was overturned: cards were not
 * separating from the wall at all, and on a dark theme there is no luminance
 * left to separate them with.
 *
 * **It is a lamplight feature, not an every-theme one.** Over a near-white card
 * the same warm wash darkens the surface toward the wall's own tone, so on
 * daylight and bright sun it subtracted from the separation instead of adding —
 * 1.222 to 1.064, and 1.180 to a card top that measured 1.031 against its wall,
 * which is no edge at all. Those two themes carry `glow: null` and take the
 * luminance step their light surfaces can afford instead.
 *
 * ## The light stops before the text does
 *
 * The first version of this put the wash *through* the card, and a `muted`
 * label at `SPACE.lg` measured 2.73:1 against a 4.5 floor. See `glowReach`: the
 * light is centred on the top edge and transparent before the content starts,
 * which is both more legible and a brighter edge than the deeper wash managed.
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
   * How far down the face the light reaches. **Must stay under the top padding
   * of whatever this is wrapping** — see `SURFACE.glowReach`, which is the
   * default and is sized for a card whose content starts at `SPACE.lg`. The
   * Tally passes a deeper one because its content starts further down.
   */
  glowReach?: number;
  /**
   * Lamplight across the head of the card, as the theme's `glow` token.
   *
   * **`null` is a real value here, not an omission.** Two of the three themes
   * carry no glow at all: over a near-white card a warm wash darkens it toward
   * the wall and *removes* the separation it was added to create. So the token
   * is nullable and this accepts the null rather than making every caller ask
   * whether their theme is the lit one.
   *
   * The token carries its own alpha, so this takes the colour and fades it to
   * transparent rather than deciding an opacity of its own.
   */
  glow?: string | null;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function Surface({
  fill,
  stroke,
  strokeWidth = 2,
  radius = SURFACE.radius,
  glowReach = SURFACE.glowReach,
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
          {glow == null ? null : (
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
           * **Centred on the top edge, so the light is gone before the text
           * starts.** It was centred 11 in and reached 61 down, which put a
           * `muted` label at 2.73:1 on a 4.5 floor — the light was landing on
           * the content instead of above it.
           *
           * Half the ellipse is off the card and clipped away, which is the
           * point: what remains is a band that is brightest at the edge and
           * transparent by `glowReach`. Brighter where it separates the card
           * from the wall, nothing at all where somebody has to read.
           */}
          {glow == null ? null : (
            <Ellipse
              cx={size.w / 2}
              cy={0}
              rx={size.w * 0.62}
              ry={glowReach}
              fill={`url(#glow-${id})`}
              clipPath={`url(#face-${id})`}
            />
          )}

          {/* The outline last, so the glow cannot wash out the edge it is
              supposed to be lighting. */}
          {stroke == null ? null : (
            <Path d={d} x={inset} y={inset} fill="none" stroke={stroke} strokeWidth={strokeWidth} />
          )}
        </Svg>
      ) : null}
      {children}
    </View>
  );
}
