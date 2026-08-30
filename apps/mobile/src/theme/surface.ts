/**
 * The card outline, as geometry.
 *
 * Split out of `components/Surface.tsx` so the suite can reach it: that file
 * imports `react-native` and `react-native-svg`, neither of which loads in
 * Node.
 *
 * ## Why a path at all, for a shape `borderRadius` can express
 *
 * This replaces `archPath`, which had to be drawn — two radii per corner is
 * not something RN's circular-only `borderRadius` can say. A rounded rectangle
 * is, so the obvious move on removing the arch is to delete the SVG with it
 * and set `borderRadius: 12`.
 *
 * The glow is why that does not work. It is a radial gradient, RN has none
 * outside SVG, and it has to stop where the card does. A styled view with a
 * gradient layer over it is two elements to keep in step and the light spills
 * at the corners — the same argument `Arch.tsx` made for putting the glow
 * inside the path rather than above it, which survives the shape change
 * unaltered. One `<Svg>` fills the card and clips the light to the same path.
 *
 * So the rectangle is drawn, and this is the shape it is drawn from.
 */

export function cardPath(w: number, h: number, r: number): string {
  /**
   * Clamped both ways. A radius wider than half the shorter side folds the
   * path through itself, and a negative one — which a surface measured at zero
   * during first layout produces — draws an arc SVG renders as a blot.
   */
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));

  return [
    `M${rr} 0`,
    `L${w - rr} 0`,
    `A${rr} ${rr} 0 0 1 ${w} ${rr}`,
    `L${w} ${h - rr}`,
    `A${rr} ${rr} 0 0 1 ${w - rr} ${h}`,
    `L${rr} ${h}`,
    `A${rr} ${rr} 0 0 1 0 ${h - rr}`,
    `L0 ${rr}`,
    `A${rr} ${rr} 0 0 1 ${rr} 0`,
    'Z',
  ].join(' ');
}
