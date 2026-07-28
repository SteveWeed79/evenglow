/**
 * The arch, as geometry.
 *
 * Split out of `components/Arch.tsx` so it can be tested. The component
 * imports `react-native` and `react-native-svg`, neither of which loads in
 * Node, and the shape of the motif is exactly the part that must not regress
 * silently — so the maths lives here, where the suite can reach it, and the
 * component is left with measuring and painting.
 *
 * The web token this replaces:
 *
 *   --arch: 50% 50% 0.5rem 0.5rem / 2rem 2rem 0.5rem 0.5rem;
 *
 * Two radii per corner — **half the width across, a fixed 32 down** — which is
 * what gives a doorway a wide shallow head on straight jambs. React Native's
 * `borderRadius` is circular only and takes no second value, so there is no
 * style that can express it: at any width wider than it is tall a circular
 * radius either domes the whole top or flattens into a rounded rectangle, and
 * both were rejected on the web for the same reason.
 */

export function archPath(w: number, h: number, spring: number, foot: number): string {
  const rx = w / 2;
  // Clamped, so a chip shorter than the spring cannot fold the path through
  // itself — the head can never be taller than the shape it sits on.
  const ry = Math.min(spring, h - foot);
  const f = Math.min(foot, h - ry);

  return [
    `M0 ${ry}`,
    `A${rx} ${ry} 0 0 1 ${w} ${ry}`,
    `L${w} ${h - f}`,
    `A${f} ${f} 0 0 1 ${w - f} ${h}`,
    `L${f} ${h}`,
    `A${f} ${f} 0 0 1 0 ${h - f}`,
    'Z',
  ].join(' ');
}
