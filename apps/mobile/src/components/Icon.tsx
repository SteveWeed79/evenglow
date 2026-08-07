/**
 * The icon set for React Native. Sixteen marks, and the number is the point.
 *
 * ## Why sixty-four became sixteen
 *
 * The test is **does this help you do the thing**, and almost nothing passed
 * it. A mark beside a word that already says the same thing is drawn twice on
 * every screen it appears on, and the app had fifty of those: `parts` beside
 * "The shelf", `egg` beside "EGGS · 6 HEAD", a doorway above the word "TODAY".
 * That is what made the set feel busy, and it is why hand-drawn charm could
 * never be got right — the budget was spread over sixty-four drawings
 * including the back arrow.
 *
 * What survived is three kinds of thing and nothing else:
 *
 *  1. **The header controls**, which are icon-only because there is no room
 *     for a word up there: `back`, `plus`, `settings`, and the lamp.
 *  2. **The five affordance signals** (`components/Touch.tsx`) — `forward`,
 *     `plus`, `minus`, `check`, `close`. A word beside one of these names the
 *     destination or the row; it never says *this navigates*, *this toggles*,
 *     *this opens*. That is the mark's job and no word does it.
 *  3. **The seven sky marks**, which are the one place a mark beats a word
 *     outright: a week strip is read as seven silhouettes at once, and seven
 *     words in that space is unreadable.
 *
 * Everything here is geometry — segments and arcs on a grid — which is the
 * other half of the answer. Nothing in this file needs an artist or a
 * generator, so nothing in it is waiting on one. Illustration is a separate
 * job at 112px and up (UX-SPEC §6), where charm is spent.
 *
 * ## The rest of the port
 *
 * Three things had to change coming off the web, and each is a real constraint
 * rather than a preference:
 *
 *  1. No sprite. react-native-svg has no cross-document <use>, so the drawings
 *     travel as data and are rebuilt as <Path>/<Circle>/<Ellipse>/<Rect> per
 *     render. Same geometry, same two masters, no <IconSprite> at the root.
 *  2. No currentColor. RN does not inherit paint, so colour is an explicit
 *     prop. Pass it from the theme — never a literal hex at the call site,
 *     which is what kept one set serving daylight, lamplight and bright sun.
 *  3. No CSS stroke defaults. Width, caps and joins are set on <Svg> here.
 *
 * The size still chooses the master: 28px and below gets the 24-unit drawing,
 * because a 25% reduction of the primary takes its counters below the floor
 * they are drawn to.
 *
 * Requires: react-native-svg.
 */

import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

type El =
  | readonly ['P', string]
  | readonly ['C', number, number, number, boolean]
  | readonly ['E', number, number, number, number]
  | readonly ['R', number, number, number, number, number | null, boolean];

const MARKS: Record<string, { readonly 32: readonly El[]; readonly 24: readonly El[] }> = {
  /**
   * Unlit: a ring. Lit: the same ring, filled.
   *
   * **This was a drawing of an oil lamp and it was never good at 24px.** The
   * body, the bail handle and the collar are three strokes doing nothing the
   * state does not — and at the one size this mark ever appears, they close up
   * into a smudge with a dot in it. The dot was always the signal; the lamp
   * was the part that had to be drawn well and never was.
   *
   * So the lamp is retired from chrome and the state is the whole mark. Two
   * elements, unmistakable at 16px, and nothing left to draw badly. If the
   * lamp is ever commissioned as the mascot it belongs at 112px on an empty
   * screen (UX-SPEC §6) — where charm is spent — and it will owe this size
   * nothing.
   */
  'lamp-unlit': {
    32: [['C', 16, 16, 7, false]],
    24: [['C', 12, 12, 5.5, false]],
  },
  'lamp-lit': {
    32: [['C', 16, 16, 7, false], ['C', 16, 16, 4, true]],
    24: [['C', 12, 12, 5.5, false], ['C', 12, 12, 3, true]],
  },
  'plus': {
    32: [['P', 'M16 6v20M6 16h20']],
    24: [['P', 'M12 4v16M4 12h16']],
  },
  'minus': {
    32: [['P', 'M6 16h20']],
    24: [['P', 'M4 12h16']],
  },
  'check': {
    32: [['P', 'M5 17 13 25 27 8']],
    24: [['P', 'M4 13 9.5 18.5 20 5']],
  },
  'close': {
    32: [['P', 'M7 7 25 25M25 7 7 25']],
    24: [['P', 'M5 5 19 19M19 5 5 19']],
  },
  'back': {
    32: [['P', 'M20 5 11 16l9 11']],
    24: [['P', 'M15 4 8 12l7 8']],
  },
  'forward': {
    32: [['P', 'M12 5l9 11-9 11']],
    24: [['P', 'M9 4l7 8-7 8']],
  },
  'settings': {
    32: [['P', 'M4 10h24M4 16h24M4 22h24'], ['R', 9, 8, 4, 4, null, true], ['R', 20, 14, 4, 4, null, true], ['R', 13, 20, 4, 4, null, true]],
    24: [['P', 'M3 7h18M3 12h18M3 17h18'], ['R', 6.5, 5.5, 3, 3, null, true], ['R', 13.5, 10.5, 3, 3, null, true], ['R', 9.5, 15.5, 3, 3, null, true]],
  },

  /**
   * The sky, in the seven states `Condition` has.
   *
   * One cloud outline, drawn once and reused at two heights: the six that are
   * not `sky-clear` share it, sitting low where nothing falls out of it and
   * lifted where something does. That is deliberate — a forecast strip is read
   * by shape at a glance across seven days, and seven unrelated drawings would
   * have to be read one at a time. What differs between them is only what is
   * happening underneath, which is the thing that differs outside.
   *
   * `sun-mode` already draws a sun and is not reused here. It is the bright-sun
   * theme control, and an icon that means "switch the display" cannot also mean
   * "clear tomorrow" — the day somebody taps the forecast expecting the theme
   * is the day the shared drawing was a false economy.
   */
  'sky-clear': {
    32: [['C', 16, 16, 6.5, false], ['P', 'M16 4v3.5M16 24.5V28M4 16h3.5M24.5 16H28M7.4 7.4l2.5 2.5M22.1 22.1l2.5 2.5M24.6 7.4l-2.5 2.5M9.9 22.1l-2.5 2.5']],
    24: [['C', 12, 12, 5, false], ['P', 'M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8']],
  },
  /**
   * The cloud sits low when nothing falls out of it and is lifted when
   * something does, so the six share one silhouette at two heights. Every
   * drawing stays inside the master's margin — 4 units at 32, 3 at 24 — which
   * `check:icons` does not verify and the sheet upstream does.
   */
  'sky-cloud': {
    32: [['P', 'M7.5 22h14.5a5 5 0 0 0-2.2-9.5A7 7 0 0 0 7 14 4.2 4.2 0 0 0 7.5 22Z']],
    24: [['P', 'M6 16.5h11a3.8 3.8 0 0 0-1.7-7.2A5.3 5.3 0 0 0 5.6 10.5 3.2 3.2 0 0 0 6 16.5Z']],
  },
  'sky-fog': {
    32: [['P', 'M8 17h13a4.5 4.5 0 0 0-2-8.5A6.3 6.3 0 0 0 7.6 10 3.8 3.8 0 0 0 8 17Z'], ['P', 'M6 22h20M9 26.5h14']],
    24: [['P', 'M6 12.5h10a3.4 3.4 0 0 0-1.5-6.4A4.8 4.8 0 0 0 5.7 7 2.9 2.9 0 0 0 6 12.5Z'], ['P', 'M4.5 16h15M7 20h10']],
  },
  'sky-drizzle': {
    32: [['P', 'M8 17h13a4.5 4.5 0 0 0-2-8.5A6.3 6.3 0 0 0 7.6 10 3.8 3.8 0 0 0 8 17Z'], ['P', 'M11 19.5v2.5M16 19.5v2.5M21 19.5v2.5M13.5 24.5v2M18.5 24.5v2']],
    24: [['P', 'M6 12.5h10a3.4 3.4 0 0 0-1.5-6.4A4.8 4.8 0 0 0 5.7 7 2.9 2.9 0 0 0 6 12.5Z'], ['P', 'M8 14.5v2M12 14.5v2M16 14.5v2M10 18.5v1.5M14 18.5v1.5']],
  },
  'sky-rain': {
    32: [['P', 'M8 17h13a4.5 4.5 0 0 0-2-8.5A6.3 6.3 0 0 0 7.6 10 3.8 3.8 0 0 0 8 17Z'], ['P', 'M11 19v5M16 19v7M21 19v5']],
    24: [['P', 'M6 12.5h10a3.4 3.4 0 0 0-1.5-6.4A4.8 4.8 0 0 0 5.7 7 2.9 2.9 0 0 0 6 12.5Z'], ['P', 'M8 14v3.5M12 14v5M16 14v3.5']],
  },
  'sky-snow': {
    32: [['P', 'M8 17h13a4.5 4.5 0 0 0-2-8.5A6.3 6.3 0 0 0 7.6 10 3.8 3.8 0 0 0 8 17Z'], ['P', 'M9.5 21.5h3.5M11.25 19.75v3.5M19 21.5h3.5M20.75 19.75v3.5M14.25 26h3.5M16 24.25v3.5']],
    24: [['P', 'M6 12.5h10a3.4 3.4 0 0 0-1.5-6.4A4.8 4.8 0 0 0 5.7 7 2.9 2.9 0 0 0 6 12.5Z'], ['P', 'M7 16h2.6M8.3 14.7v2.6M14.4 16H17M15.7 14.7v2.6M10.7 19.4h2.6M12 18.1v2.6']],
  },
  'sky-storm': {
    32: [['P', 'M8 17h13a4.5 4.5 0 0 0-2-8.5A6.3 6.3 0 0 0 7.6 10 3.8 3.8 0 0 0 8 17Z'], ['P', 'M17.5 18 13 23.5h3.5L14 28']],
    24: [['P', 'M6 12.5h10a3.4 3.4 0 0 0-1.5-6.4A4.8 4.8 0 0 0 5.7 7 2.9 2.9 0 0 0 6 12.5Z'], ['P', 'M13 13.5 9.5 18h3L10.5 21']],
  },
};

export const ICON_NAMES = Object.keys(MARKS) as readonly IconName[];
export type IconName = keyof typeof MARKS;

/** The boundary between the two masters, in rendered px. */
export const SMALL_MASTER_MAX = 28;

export interface IconProps {
  name: IconName;
  /** Rendered px, both axes. Default 24. */
  size?: number;
  /** Required: RN cannot inherit paint. Feed it a token, not a literal. */
  color: string;
  /** Screen-reader label. Omit for decoration beside its own word. */
  label?: string;
}

export function Icon({ name, size = 24, color, label }: IconProps): React.ReactElement {
  const master: 24 | 32 = size <= SMALL_MASTER_MAX ? 24 : 32;
  // `name` is typed to the manifest, so a miss is impossible through the type
  // system — but noUncheckedIndexedAccess is right that a Record lookup is not
  // a proof, and an empty array renders nothing rather than throwing in a barn.
  const marks = MARKS[name]?.[master] ?? [];

  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${master} ${master}`}
      fill="none"
      stroke={color}
      strokeWidth={master === 32 ? 2.5 : 2}
      /**
       * Round, not square — and this is the cheapest warmth in the app.
       *
       * A square cap and a mitred join are what make a geometric set read as
       * *drafted*: the corners come to points and every stroke ends on a hard
       * edge. Rounding both softens forty-six marks at once without altering a
       * single path, which is the whole argument for spending the charm budget
       * on the ten drawn marks and leaving the controls alone (UX-SPEC §6).
       */
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={label !== undefined}
      accessibilityRole={label === undefined ? 'none' : 'image'}
      {...(label === undefined ? {} : { accessibilityLabel: label })}
    >
      {marks.map((el, i) => {
        if (el[0] === 'P') return <Path key={i} d={el[1]} />;
        if (el[0] === 'C') {
          const [, cx, cy, r, solid] = el;
          return <Circle key={i} cx={cx} cy={cy} r={r} fill={solid ? color : 'none'} stroke={solid ? 'none' : color} />;
        }
        if (el[0] === 'E') {
          const [, cx, cy, rx, ry] = el;
          return <Ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} />;
        }
        const [, x, y, w, h, rx, solid] = el;
        return (
          <Rect
            key={i}
            x={x} y={y} width={w} height={h}
            {...(rx === null ? {} : { rx })}
            fill={solid ? color : 'none'}
            stroke={solid ? 'none' : color}
          />
        );
      })}
    </Svg>
  );
}
