/**
 * The icon set (3.0) for React Native. Generated from "Steading Icons v3.dc.html".
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
  'today': {
    32: [['P', 'M6 26V15a10 10 0 0 1 20 0v11'], ['C', 21, 20, 1.7, true]],
    24: [['P', 'M5 20V11a7 7 0 0 1 14 0v9'], ['C', 15, 15, 1.2, true]],
  },
  'stock': {
    32: [['P', 'M4 26v-8a12 9 0 0 1 24 0v8'], ['P', 'M12 26v-6a4 4 0 0 1 8 0v6']],
    24: [['P', 'M3 20v-6a9 7 0 0 1 18 0v6'], ['P', 'M9 20v-5a3 3 0 0 1 6 0v5']],
  },
  'iron': {
    32: [['P', 'M16 4 26 10v12l-10 6-10-6V10Z'], ['C', 16, 16, 5, false]],
    24: [['P', 'M12 3 19 7v10l-7 4-7-4V7Z'], ['C', 12, 12, 3, false]],
  },
  'growing': {
    32: [['P', 'M4 26h24'], ['P', 'M10 26v-5M16 26v-11M22 26v-7'], ['P', 'M16 17a5.5 5.5 0 0 1 5.5-5.5A5.5 5.5 0 0 1 16 17Z']],
    24: [['P', 'M3 20h18'], ['P', 'M8 20v-4M12 20v-8M16 20v-5'], ['P', 'M12 13a4 4 0 0 1 4-4 4 4 0 0 1-4 4Z']],
  },
  'more': {
    32: [['C', 8, 16, 2.3, true], ['C', 16, 16, 2.3, true], ['C', 24, 16, 2.3, true]],
    24: [['C', 6, 12, 1.7, true], ['C', 12, 12, 1.7, true], ['C', 18, 12, 1.7, true]],
  },
  'saved': {
    32: [['C', 16, 16, 11.4, false], ['P', 'M10 16.5 14.5 21 22.5 10']],
    24: [['C', 12, 12, 8.6, false], ['P', 'M7.5 12.5 11 16 17 7.5']],
  },
  'waiting': {
    32: [['C', 16, 16, 11.4, false], ['P', 'M16 8.5V16l5.5 3'], ['C', 16, 16, 1.5, true]],
    24: [['C', 12, 12, 8.6, false], ['P', 'M12 6.5V12l4 2'], ['C', 12, 12, 1, true]],
  },
  'sending': {
    32: [['C', 16, 16, 11.4, false], ['P', 'M16 22V10m-4.5 4.5L16 10l4.5 4.5']],
    24: [['C', 12, 12, 8.6, false], ['P', 'M12 16.5V7.5m-3.5 3.5L12 7.5l3.5 3.5']],
  },
  'needs-a-look': {
    32: [['P', 'M16 4.5 28.5 26.5H3.5Z'], ['P', 'M16 13v6'], ['C', 16, 23, 1.5, true]],
    24: [['P', 'M12 3.5 21.5 20H2.5Z'], ['P', 'M12 10v4'], ['C', 12, 17, 1.1, true]],
  },
  'offline': {
    32: [['C', 16, 16, 11.4, false], ['P', 'M8 24 24 8']],
    24: [['C', 12, 12, 8.6, false], ['P', 'M6 18 18 6']],
  },
  'lamp-unlit': {
    32: [['P', 'M16 4v3M11 7h10'], ['P', 'M10 26v-9a6 6 0 0 1 12 0v9'], ['C', 16, 19, 2.6, false]],
    24: [['P', 'M12 3v2M8 5h8'], ['P', 'M8 20v-7a4 4 0 0 1 8 0v7'], ['C', 12, 14, 2, false]],
  },
  'lamp-lit': {
    32: [['P', 'M16 4v3M11 7h10'], ['P', 'M10 26v-9a6 6 0 0 1 12 0v9'], ['C', 16, 19, 2.6, true]],
    24: [['P', 'M12 3v2M8 5h8'], ['P', 'M8 20v-7a4 4 0 0 1 8 0v7'], ['C', 12, 14, 2, true]],
  },
  'sun-mode': {
    32: [['C', 16, 16, 5.6, false], ['P', 'M16 4v3M16 25v3M4 16h3M25 16h3M7.5 7.5l2.1 2.1M22.4 22.4l2.1 2.1M24.5 7.5l-2.1 2.1M9.6 22.4l-2.1 2.1']],
    24: [['C', 12, 12, 4, false], ['P', 'M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M5.9 5.9l1.5 1.5M16.6 16.6l1.5 1.5M18.1 5.9l-1.5 1.5M5.9 18.1l1.5-1.5']],
  },
  'diagnostics': {
    32: [['P', 'M5 5h22v22H5Z'], ['P', 'M5 13h22'], ['P', 'M10 20h12']],
    24: [['P', 'M4 4h16v16H4Z'], ['P', 'M4 10h16'], ['P', 'M8 15h8']],
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
  'try-again': {
    32: [['P', 'M27.4 16a11.4 11.4 0 1 1-4.4-9'], ['P', 'M28 4.5V11h-6.5']],
    24: [['P', 'M20.6 12a8.6 8.6 0 1 1-3.3-6.8'], ['P', 'M21 4v5h-5']],
  },
  'discard': {
    32: [['P', 'M8 11h16v15H8Z'], ['P', 'M4 11h24'], ['P', 'M12 11V7h8v4'], ['P', 'M13 16v5M19 16v5']],
    24: [['P', 'M6 8h12v12H6Z'], ['P', 'M3 8h18'], ['P', 'M9 8V5h6v3'], ['P', 'M10 12v4M14 12v4']],
  },
  'copy': {
    32: [['P', 'M5 16V5h11'], ['P', 'M12 12h15v15H12Z']],
    24: [['P', 'M4 12V4h8'], ['P', 'M9 9h11v11H9Z']],
  },
  'edit': {
    32: [['P', 'M6 26l1.5-6L23 4.5 27.5 9 12 24.5Z'], ['P', 'M19 8.5l4.5 4.5']],
    24: [['P', 'M4.5 19.5l1-4.5L17 3.5 20.5 7 9 18.5Z'], ['P', 'M14 6.5l3.5 3.5']],
  },
  'photo': {
    32: [['P', 'M4 11h24v15H4Z'], ['P', 'M12 11V7h8v4'], ['C', 16, 18.5, 5, false], ['C', 24, 15, 1.5, true]],
    24: [['P', 'M3 8h18v12H3Z'], ['P', 'M9 8V5h6v3'], ['C', 12, 14.5, 3.25, false], ['C', 18, 11, 1.1, true]],
  },
  'export': {
    32: [['P', 'M5 20v6h22v-6'], ['P', 'M16 21V5m-5 5 5-5 5 5']],
    24: [['P', 'M4 15v5h16v-5'], ['P', 'M12 16V4m-4 4 4-4 4 4']],
  },
  'sign-out': {
    32: [['P', 'M5 26V16a7 7 0 0 1 14 0v10'], ['P', 'M23 16h5m-2.5-2.5L28 16l-2.5 2.5'], ['C', 15, 21, 1.5, true]],
    24: [['P', 'M4 20V12a5 5 0 0 1 10 0v8'], ['P', 'M17 16h4m-2-2 2 2-2 2'], ['C', 10, 16, 1, true]],
  },
  'search': {
    32: [['C', 14, 14, 8.6, false], ['P', 'M20.2 20.2 27.5 27.5']],
    24: [['C', 10, 10, 6.5, false], ['P', 'M14.6 14.6 20.5 20.5']],
  },
  'settings': {
    32: [['P', 'M4 10h24M4 16h24M4 22h24'], ['R', 9, 8, 4, 4, null, true], ['R', 20, 14, 4, 4, null, true], ['R', 13, 20, 4, 4, null, true]],
    24: [['P', 'M3 7h18M3 12h18M3 17h18'], ['R', 6.5, 5.5, 3, 3, null, true], ['R', 13.5, 10.5, 3, 3, null, true], ['R', 9.5, 15.5, 3, 3, null, true]],
  },
  'basic-full': {
    32: [['P', 'M6 13h20M6 20h11'], ['R', 19, 18, 4, 4, null, true]],
    24: [['P', 'M4 9h16M4 15h9'], ['R', 16, 13.5, 3, 3, null, true]],
  },
  'egg': {
    32: [['E', 16, 17, 8, 10.5]],
    24: [['E', 12, 13, 6, 8]],
  },
  'basket': {
    32: [['P', 'M5 14h22'], ['P', 'M8 14l2.5 12h11L24 14'], ['P', 'M11 14a5 5 0 0 1 10 0'], ['C', 16, 14, 1.7, true]],
    24: [['P', 'M3 10h18'], ['P', 'M5 10l2 9h10l2-9'], ['P', 'M8 10a4 4 0 0 1 8 0'], ['C', 12, 10, 1.2, true]],
  },
  'milk': {
    32: [['P', 'M12 5h8v3.5l3 4V26H9V12.5l3-4Z'], ['P', 'M9 19h14']],
    24: [['P', 'M9 4h6v2l2 3v11H7V9l2-3Z'], ['P', 'M7 14h10']],
  },
  'meat': {
    32: [['P', 'M4 24h24'], ['P', 'M11 24v-6a5 5 0 0 1 10 0v6'], ['C', 16, 21, 1.25, true]],
    24: [['P', 'M3 18h18'], ['P', 'M9 18v-4a3 3 0 0 1 6 0v4'], ['C', 12, 16, 1, true]],
  },
  'withdrawal': {
    32: [['E', 16, 17, 8, 10.5], ['P', 'M6 25 26 7']],
    24: [['E', 12, 13, 6, 8], ['P', 'M4 19 20 5']],
  },
  'head-count': {
    32: [['C', 9.5, 13, 3.4, false], ['C', 22.5, 13, 3.4, false], ['C', 16, 21.5, 3.4, false]],
    24: [['C', 7, 10, 2.5, false], ['C', 17, 10, 2.5, false], ['C', 12, 16, 2.5, false]],
  },
  'feed': {
    32: [['P', 'M9 12h14v14H9Z'], ['P', 'M10.5 12l1.5-4h8l1.5 4'], ['P', 'M9 19h14']],
    24: [['P', 'M7 9h10v11H7Z'], ['P', 'M8 9l1-3h6l1 3'], ['P', 'M7 14h10']],
  },
  'waterer': {
    32: [['P', 'M5 13v5a6 6 0 0 0 6 6h10a6 6 0 0 0 6-6v-5Z'], ['P', 'M9.5 18h13']],
    24: [['P', 'M4 10v4a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4v-4Z'], ['P', 'M7 14h10']],
  },
  'nest-box': {
    32: [['P', 'M5 26v-7a11 8 0 0 1 22 0v7'], ['C', 10, 22.5, 2, true], ['C', 16, 22.5, 2, true], ['C', 22, 22.5, 2, true]],
    24: [['P', 'M4 20v-5a8 6 0 0 1 16 0v5'], ['C', 8, 17, 1.25, true], ['C', 12, 17, 1.25, true], ['C', 16, 17, 1.25, true]],
  },
  'medication': {
    32: [['P', 'M11 12h10v14H11Z'], ['R', 13.5, 5, 5, 4, null, true], ['P', 'M11 19h10']],
    24: [['P', 'M8 10h8v10H8Z'], ['R', 10, 4, 4, 3, null, true], ['P', 'M8 15h8']],
  },
  'in-water': {
    32: [['P', 'M16 5l6.5 11.5A7.5 7.5 0 1 1 9.5 16.5Z']],
    24: [['P', 'M12 4l5 8.5A5.5 5.5 0 1 1 7 12.5Z']],
  },
  'injected': {
    32: [['P', 'M7.9 19.9 18.9 8.9 23.1 13.1 12.1 24.1Z'], ['P', 'M10 22 5.5 26.5'], ['P', 'M17.5 7.5 24.5 14.5'], ['P', 'M21 11 25.5 6.5']],
    24: [['P', 'M5.9 14.9 14.2 6.7 17.3 9.8 9.1 18.1Z'], ['P', 'M7.5 16.5 4 20'], ['P', 'M13 5.6 18.4 11'], ['P', 'M15.75 8.25 19 5']],
  },
  'mortality': {
    32: [['P', 'M9 26v-9a7 7 0 0 1 14 0v9'], ['P', 'M4 26h24'], ['P', 'M16 20v6']],
    24: [['P', 'M7 20v-7a5 5 0 0 1 10 0v7'], ['P', 'M3 20h18'], ['P', 'M12 15v5']],
  },
  'tractor': {
    32: [['P', 'M5 16V11h6.3V6h14.4v10A8.5 8.5 0 0 0 11.3 16Z'], ['C', 18.5, 20.5, 5, false], ['C', 7, 22.5, 3, false], ['C', 18.5, 20.5, 1.25, true]],
    24: [['P', 'M3 11V7h7V4h10v7A7 7 0 0 0 10 11Z'], ['C', 15, 16, 4, false], ['C', 6, 18, 2, false], ['C', 15, 16, 1, true]],
  },
  'mower': {
    32: [['P', 'M5 9h17v7.5H5Z'], ['C', 9, 23, 3, false], ['C', 19, 23, 3, false], ['P', 'M22 9l5-5']],
    24: [['P', 'M4 6h13v6H4Z'], ['C', 7, 18, 2, false], ['C', 15, 18, 2, false], ['P', 'M17 6l4-4']],
  },
  'pump': {
    32: [['C', 14, 15, 6, false], ['P', 'M10 19l1 7h6l1-7'], ['P', 'M14 9V4'], ['P', 'M20 15h8']],
    24: [['C', 10, 11, 4.5, false], ['P', 'M7 14l1 6h4l1-6'], ['P', 'M10 6.5V3'], ['P', 'M15 11h6']],
  },
  'hour-meter': {
    32: [['R', 4, 11, 24, 11, 1.5, false], ['P', 'M11 15v4M16 15v4M21 15v4'], ['C', 24.5, 16, 1.25, true]],
    24: [['R', 3, 8, 18, 9, 1, false], ['P', 'M8 11v3M12 11v3M16 11v3'], ['C', 18, 12, 1, true]],
  },
  'service': {
    32: [['C', 11.5, 11.5, 6, false], ['P', 'M15.8 15.8 26.5 26.5'], ['C', 11.5, 11.5, 1.6, true]],
    24: [['C', 9, 9, 4.5, false], ['P', 'M12.2 12.2 20 20'], ['C', 9, 9, 1.25, true]],
  },
  'fuel': {
    32: [['P', 'M7 12h13v14H7Z'], ['R', 11, 6, 5, 3.5, null, true], ['P', 'M20 16h6v10']],
    24: [['P', 'M5 9h10v11H5Z'], ['R', 8, 4, 4, 3, null, true], ['P', 'M15 12h5v8']],
  },
  'date-due': {
    32: [['R', 5, 9, 22, 17, 1.5, false], ['P', 'M11 9V5M21 9V5'], ['P', 'M5 17h22']],
    24: [['R', 4, 7, 16, 13, 1, false], ['P', 'M8 7V4M16 7V4'], ['P', 'M4 12h16']],
  },
  'parts': {
    32: [['P', 'M16 4 26 10v12l-10 6-10-6V10Z'], ['P', 'M12 16h8']],
    24: [['P', 'M12 3 19 7v10l-7 4-7-4V7Z'], ['P', 'M9 12h6']],
  },
  'streak-plant': {
    32: [['P', 'M16 26V12'], ['P', 'M16 18.5a6.5 6.5 0 0 1 6.5-6.5 6.5 6.5 0 0 1-6.5 6.5Z'], ['P', 'M16 24a6.5 6.5 0 0 0-6.5-6.5A6.5 6.5 0 0 0 16 24Z'], ['P', 'M7 26h18']],
    24: [['P', 'M12 20V9'], ['P', 'M12 14a5 5 0 0 1 5-5 5 5 0 0 1-5 5Z'], ['P', 'M12 18a5 5 0 0 0-5-5 5 5 0 0 0 5 5Z'], ['P', 'M5 20h14']],
  },
  'milestone': {
    32: [['P', 'M7 26V17a9 9 0 0 1 18 0v9'], ['C', 16, 20, 2.6, true]],
    24: [['P', 'M5 20V13a7 7 0 0 1 14 0v7'], ['C', 12, 16, 2, true]],
  },
  'season': {
    32: [['C', 16, 13, 5, false], ['P', 'M16 4v3M5 13h3M24 13h3M8.4 5.4l2.1 2.1M23.6 5.4l-2.1 2.1'], ['P', 'M4 23h24']],
    24: [['C', 12, 10, 4, false], ['P', 'M12 2v1.5M4 10h1.5M18.5 10H20M6.3 4.3l1.1 1.1M17.7 4.3l-1.1 1.1'], ['P', 'M3 17h18']],
  },
  'hung-lantern': {
    32: [['P', 'M16 3v3M10 6h12'], ['P', 'M9 26v-9a7 7 0 0 1 14 0v9'], ['P', 'M9 17h14'], ['C', 16, 21.5, 2.2, true]],
    24: [['P', 'M12 2v2M8 4h8'], ['P', 'M7 20v-7a5 5 0 0 1 10 0v7'], ['P', 'M7 12h10'], ['C', 12, 16, 1.6, true]],
  },
  'bench': {
    32: [['P', 'M4 14h24'], ['P', 'M8 14v12M24 14v12'], ['P', 'M12 14v-5a4 4 0 0 1 8 0v5']],
    24: [['P', 'M3 11h18'], ['P', 'M6 11v9M18 11v9'], ['P', 'M9 11V7a3 3 0 0 1 6 0v4']],
  },
  'arch': {
    32: [['P', 'M6 26V15a10 10 0 0 1 20 0v11'], ['P', 'M3 26h26']],
    24: [['P', 'M5 20V11a7 7 0 0 1 14 0v9'], ['P', 'M3 20h18']],
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
      strokeLinecap="square"
      strokeLinejoin="miter"
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
