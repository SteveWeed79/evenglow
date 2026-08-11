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

import { useId } from 'react';
import Svg, { Circle, Defs, Ellipse, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

type El =
  /** The optional third is `solid`, matching `C` and `R`: fill it, do not stroke it. */
  | readonly ['P', string, boolean?]
  | readonly ['C', number, number, number, boolean]
  | readonly ['E', number, number, number, number]
  | readonly ['R', number, number, number, number, number | null, boolean];

/**
 * The lamp, and the one mark in this file that is not segments on a grid.
 *
 * **Stated as an exception rather than smuggled in.** Everything else here is
 * geometry precisely so nothing waits on an artist; this is a filled
 * letterform-density silhouette, and it is here because the header toggle is
 * the one control whose *subject* is the app's own motif. A ring said "on/off"
 * perfectly and said nothing about what was being switched.
 *
 * Rescaled from a 512-unit source to these two grids by uniform transform, so
 * the curve is the original's and not a redrawing of it. The mark spans 26 of
 * 32 units rather than filling the box: the lit state paints a `RadialGradient`
 * behind it, react-native-svg clips to the viewBox, and Android clips child
 * views harder than iOS — so the halo has to have somewhere to be.
 */
const LANTERN_32 =
  'M22.69 14.25L19.39 7.86c-0.13 -0.25 -0.38 -0.42 -0.65 -0.46V5.72C18.74 4.22 17.52 3 16.02 3s-2.72 1.22 -2.72 2.72v1.67c-0.29 0.03 -0.55 0.2 -0.69 0.47l-3.3 6.39c-0.93 1.8 -1.25 3.9 -0.91 5.9l0.56 3.25c0.2 1.17 1.1 2.05 2.23 2.26c0 0.02 0 0.04 0 0.06v0.87h-0.42c-0.36 0 -0.65 0.29 -0.65 0.65v1.1c0 0.36 0.29 0.65 0.65 0.65h10.47c0.36 0 0.65 -0.29 0.65 -0.65v-1.1c0 -0.36 -0.29 -0.65 -0.65 -0.65h-0.42v-0.87c0 -0.02 0 -0.04 0 -0.06c1.13 -0.21 2.03 -1.09 2.23 -2.26l0.56 -3.25C23.95 18.15 23.63 16.05 22.69 14.25zM12.61 23.97h-0.92c-0.51 0 -0.94 -0.36 -1.02 -0.86l-0.56 -3.25c-0.28 -1.63 -0.02 -3.34 0.74 -4.81l2.06 -3.99l-0.94 7.8L12.61 23.97zM16.02 4.73c0.54 0 0.99 0.44 0.99 0.99v1.67h-1.97v-1.67h0C15.03 5.18 15.47 4.73 16.02 4.73zM16.72 23.91c-0.12 0.03 -0.22 -0.09 -0.16 -0.2c0.18 -0.33 0.33 -0.79 -0.04 -1.07c-0.62 -0.47 -0.34 -1.18 -0.34 -1.18s-0.99 0.52 -0.95 1.29c0.02 0.38 0.14 0.7 0.29 0.98c0.06 0.11 -0.04 0.23 -0.15 0.2c-0.03 -0.01 -0.06 -0.01 -0.1 -0.02c-1.63 -0.39 -1.47 -1.99 -0.45 -2.97c1.19 -1.14 0.67 -2.01 0.67 -2.01s1.4 0.24 2.28 2.44C18.34 22.78 17.71 23.64 16.72 23.91zM21.89 19.85l-0.56 3.25c-0.09 0.5 -0.52 0.86 -1.02 0.86h-1.01l0.65 -5.12l-0.97 -8.03l2.18 4.22C21.91 16.51 22.18 18.22 21.89 19.85z';

const LANTERN_24 =
  'M17.02 10.69L14.55 5.89c-0.1 -0.19 -0.28 -0.32 -0.49 -0.35V4.29C14.06 3.17 13.14 2.25 12.01 2.25s-2.04 0.92 -2.04 2.04v1.25c-0.22 0.02 -0.42 0.15 -0.52 0.35l-2.48 4.79c-0.7 1.35 -0.94 2.92 -0.68 4.43l0.42 2.44c0.15 0.87 0.83 1.54 1.67 1.69c0 0.02 0 0.03 0 0.05v0.65h-0.32c-0.27 0 -0.49 0.22 -0.49 0.49v0.83c0 0.27 0.22 0.49 0.49 0.49h7.85c0.27 0 0.49 -0.22 0.49 -0.49v-0.83c0 -0.27 -0.22 -0.49 -0.49 -0.49h-0.32v-0.65c0 -0.02 0 -0.03 0 -0.05c0.85 -0.15 1.52 -0.82 1.67 -1.69l0.42 -2.44C17.96 13.61 17.72 12.04 17.02 10.69zM9.46 17.98h-0.69c-0.38 0 -0.7 -0.27 -0.77 -0.65l-0.42 -2.44c-0.21 -1.22 -0.01 -2.5 0.56 -3.61l1.55 -2.99l-0.71 5.85L9.46 17.98zM12.01 3.55c0.41 0 0.74 0.33 0.74 0.74v1.25h-1.48v-1.25h0C11.27 3.88 11.61 3.55 12.01 3.55zM12.54 17.93c-0.09 0.02 -0.16 -0.07 -0.12 -0.15c0.13 -0.24 0.25 -0.59 -0.03 -0.8c-0.46 -0.35 -0.25 -0.88 -0.25 -0.88s-0.74 0.39 -0.72 0.97c0.01 0.28 0.1 0.53 0.22 0.73c0.04 0.08 -0.03 0.17 -0.11 0.15c-0.02 -0.01 -0.05 -0.01 -0.07 -0.02c-1.22 -0.29 -1.1 -1.49 -0.34 -2.23c0.89 -0.86 0.5 -1.51 0.5 -1.51s1.05 0.18 1.71 1.83C13.76 17.08 13.28 17.73 12.54 17.93zM16.42 14.89l-0.42 2.44c-0.06 0.38 -0.39 0.65 -0.77 0.65h-0.76l0.48 -3.84l-0.73 -6.02l1.63 3.16C16.43 12.39 16.63 13.67 16.42 14.89z';

const MARKS: Record<string, { readonly 32: readonly El[]; readonly 24: readonly El[] }> = {
  /**
   * The lamp — **one drawing, two states.**
   *
   * A ring was here, filled when lit, and the note beside it said an oil lamp
   * "was never good at 24px". That was true and it was true of a *stroked*
   * lamp: body, bail and collar are three hairlines that close into a smudge.
   * This one is a filled silhouette drawn at 32, where mass survives what line
   * does not — checked at 16, 24, 32 and 40 against the real header before it
   * was taken.
   *
   * **Both names carry the same path on purpose.** The ring pair differed by
   * geometry; this pair differs by paint — `lanternInk` with a glow behind it,
   * or `muted` with none — which `LampToggle` supplies. Two names for one
   * drawing would ordinarily be an invitation to drift, so they share a
   * constant rather than a copy: they cannot.
   *
   * What a ring could never say is *what* is being switched. That is the whole
   * reason to spend an exception here and nowhere else in the file.
   */
  'lamp-unlit': {
    32: [['P', LANTERN_32, true]],
    24: [['P', LANTERN_24, true]],
  },
  'lamp-lit': {
    32: [['P', LANTERN_32, true]],
    24: [['P', LANTERN_24, true]],
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
  /**
   * A halo behind the mark, in the colour given. Omit for none.
   *
   * A `RadialGradient` rather than `FeGaussianBlur`, and that is a portability
   * decision rather than a stylistic one: react-native-svg ships the filter
   * primitives, but Android's implementation barely blurs and stops responding
   * past `stdDeviation` 15 (software-mansion/react-native-svg#2636). Android is
   * this app's first platform, so the glow is drawn as geometry — the same way
   * `Arch.tsx` draws the light through a doorway.
   */
  glow?: string;
}

export function Icon({ name, size = 24, color, label, glow }: IconProps): React.ReactElement | null {
  /**
   * Unique per instance, and the `:` must go.
   *
   * Gradient ids are global to the document: two lit lamps on one screen would
   * both resolve `url(#glow)` to whichever rendered last. `useId` returns
   * `:r0:`, and a colon is not valid in an id a `url(#…)` can reach — the same
   * fix, for the same reason, as `Arch.tsx`.
   */
  const haloId = `lamp-glow-${useId().replace(/:/g, '')}`;
  const master: 24 | 32 = size <= SMALL_MASTER_MAX ? 24 : 32;
  // `name` is typed to the manifest, so a miss is impossible through the type
  // system — but noUncheckedIndexedAccess is right that a Record lookup is not
  // a proof, and an empty array renders nothing rather than throwing in a barn.
  const marks = MARKS[name]?.[master];

  /**
   * Nothing at all for a mark that is not in the set — not an empty box of the
   * right size.
   *
   * This drew a 24px `<Svg>` with no paths in it, which is a *silent indent*:
   * a row whose mark does not exist keeps the mark's width and pushes its
   * words right, and the row above it does not. Two dangling `icon="sync"`
   * references lived that way until somebody looked at Settings and asked why
   * one line was further in than the rest.
   *
   * A hole is findable and a shift is not, so the drawing has to disappear
   * rather than merely be empty. `check:icons` is the half that stops the
   * reference existing; this is the half that makes it visible when one does.
   */
  if (marks === undefined) return null;

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
      {/**
       * Behind everything, and inside the box.
       *
       * The circle is drawn to the viewBox's own half-width so its outermost
       * stop lands exactly on the edge at zero alpha — a halo that reached
       * further would not spill, it would be *cut*, and a clipped gradient
       * shows as a square of haze. Marks that want a glow leave themselves
       * room; see `LANTERN_32`.
       */}
      {glow === undefined ? null : (
        <>
          <Defs>
            <RadialGradient id={haloId}>
              <Stop offset="0" stopColor={glow} stopOpacity="0.55" />
              {/* Same hue throughout. A stop that changed colour as well as
                  opacity would fade brass through grey on the way out. */}
              <Stop offset="0.5" stopColor={glow} stopOpacity="0.22" />
              <Stop offset="1" stopColor={glow} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle
            cx={master / 2}
            cy={master / 2}
            r={master / 2}
            fill={`url(#${haloId})`}
            stroke="none"
          />
        </>
      )}

      {marks.map((el, i) => {
        if (el[0] === 'P') {
          const solid = el[2] === true;
          return (
            <Path key={i} d={el[1]} fill={solid ? color : 'none'} stroke={solid ? 'none' : color} />
          );
        }
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
