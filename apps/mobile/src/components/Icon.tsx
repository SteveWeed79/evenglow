import { Circle, Ellipse, Path, Rect, Svg } from 'react-native-svg';

/**
 * The Steading icon set — 24x24, stroke 2, square caps, mitred joins.
 *
 * Ported from `apps/app/src/components/Icon.tsx` with the geometry byte-for-byte
 * intact; only the element names and the root change. That is deliberate — the
 * set is built on one constructive rule, **arched things are places you go or
 * keep, squared things are tools you use**, and the rule only survives if the
 * shapes do. Do not redraw an icon here to suit a screen; change it in the set.
 *
 * `currentColor` works because react-native-svg resolves it against the
 * `color` prop on the root, the same way a browser resolves it against the
 * inherited colour. So one set still serves daylight, lamplight and
 * bright-sun without a second asset.
 *
 * The web copy is the source until R4 deletes the web screens. Until then,
 * edit there and re-port; two hands drawing one set is how a set stops
 * looking like one.
 */

export type IconName =
  | 'arch'
  | 'back'
  | 'basket'
  | 'bench'
  | 'check'
  | 'close'
  | 'copy'
  | 'date-due'
  | 'diagnostics'
  | 'discard'
  | 'edit'
  | 'egg'
  | 'export'
  | 'feed'
  | 'forward'
  | 'fuel'
  | 'head-count'
  | 'hour-meter'
  | 'hung-lantern'
  | 'in-water'
  | 'injected'
  | 'iron'
  | 'lamp-lit'
  | 'lamp-unlit'
  | 'meat'
  | 'medication'
  | 'milestone'
  | 'milk'
  | 'minus'
  | 'more'
  | 'mortality'
  | 'mower'
  | 'needs-a-look'
  | 'nest-box'
  | 'offline'
  | 'parts'
  | 'photo'
  | 'plus'
  | 'pump'
  | 'saved'
  | 'search'
  | 'season'
  | 'sending'
  | 'service'
  | 'settings'
  | 'sign-out'
  | 'stock'
  | 'sun-mode'
  | 'today'
  | 'tractor'
  | 'try-again'
  | 'waiting'
  | 'waterer'
  | 'withdrawal';


const PATHS: Record<IconName, React.ReactElement> = {
  'arch': (
    <><Path d="M4 20V11a8 8 0 0 1 16 0v9" /><Path d="M2 21h20" /></>
  ),
  'back': (
    <><Path d="M15 4 8 12l7 8" /></>
  ),
  'basket': (
    <><Path d="M4 11h16l-2.2 9H6.2Z" /><Path d="M7.5 11a4.5 4.5 0 0 1 9 0" /><Path d="M5 15h14" /></>
  ),
  'bench': (
    <><Path d="M3 10h18" /><Path d="M5.5 10v10M18.5 10v10" /><Path d="M9 10V7a3 3 0 0 1 6 0v3" /></>
  ),
  'check': (
    <><Path d="M4 12.5 9.5 18 20 6.5" /></>
  ),
  'close': (
    <><Path d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5" /></>
  ),
  'copy': (
    <><Path d="M4 4h11v11H4Z" /><Path d="M8 20h12V8" /></>
  ),
  'date-due': (
    <><Rect x="4" y="6" width="16" height="14" rx="1" /><Path d="M9 6V3M15 6V3" /><Path d="M4 11h16" /></>
  ),
  'diagnostics': (
    <><Rect x="3" y="5" width="18" height="14" rx="1" /><Path d="M3 10h18" /><Path d="M7 14h5" /></>
  ),
  'discard': (
    <><Path d="M5 7h14v13H5Z" /><Path d="M3 7h18" /><Path d="M9.5 7V4h5v3" /><Path d="M10 11v5M14 11v5" /></>
  ),
  'edit': (
    <><Path d="M4 20h4L19 9l-4-4L4 16Z" /><Path d="M14 6l4 4" /></>
  ),
  'egg': (
    <><Ellipse cx="12" cy="13.5" rx="6.2" ry="7.8" /></>
  ),
  'export': (
    <><Path d="M4 15v5h16v-5" /><Path d="M12 16V4" /><Path d="M8.5 7.5 12 4l3.5 3.5" /></>
  ),
  'feed': (
    <><Path d="M7 9h10v11H7Z" /><Path d="M9 9l1-3h4l1 3" /><Path d="M7 14h10" /></>
  ),
  'forward': (
    <><Path d="M9 4l7 8-7 8" /></>
  ),
  'fuel': (
    <><Rect x="5" y="8" width="11" height="12" rx="1" /><Path d="M10 8V5h4v3" /><Path d="M16 11h4v7" /></>
  ),
  'head-count': (
    <><Circle cx="7" cy="10" r="2.6" /><Circle cx="17" cy="10" r="2.6" /><Circle cx="12" cy="16.5" r="2.6" /></>
  ),
  'hour-meter': (
    <><Rect x="3" y="8" width="18" height="9" rx="1" /><Path d="M8 11v3M12 11v3M16 11v3" /></>
  ),
  'hung-lantern': (
    <><Path d="M12 2v3" /><Path d="M8 17v-4a4 4 0 0 1 8 0v4" /><Path d="M6.5 20h11" /><Path d="M8 17h8" /></>
  ),
  'in-water': (
    <><Path d="M12 3.5 17 12a5 5 0 1 1-10 0Z" /></>
  ),
  'injected': (
    <><Rect x="9" y="5" width="6" height="12" rotation={-45} originX={12} originY={11} /><Path d="M3.5 20.5 7 17" /><Path d="M13 3.5 17.5 8" /></>
  ),
  'iron': (
    <><Path d="M12 3 20 7.5v9L12 21 4 16.5v-9Z" /><Circle cx="12" cy="12" r="3.4" /></>
  ),
  'lamp-lit': (
    <><Path d="M12 2v2.5" /><Path d="M6 19v-5a6 6 0 0 1 12 0v5" /><Path d="M4.5 19h15" /><Circle cx="12" cy="14" r="2.2" fill="currentColor" stroke="none" /></>
  ),
  'lamp-unlit': (
    <><Path d="M12 2v2.5" /><Path d="M6 19v-5a6 6 0 0 1 12 0v5" /><Path d="M4.5 19h15" /><Circle cx="12" cy="14" r="2.2" /></>
  ),
  'meat': (
    <><Path d="M4 15h16v5H4Z" /><Path d="M8 15v-3a4 4 0 0 1 8 0v3" /></>
  ),
  'medication': (
    <><Path d="M8 8h8v12H8Z" /><Path d="M10 8V4h4v4" /><Path d="M8 13h8" /></>
  ),
  'milestone': (
    <><Path d="M5 20v-7a7 7 0 0 1 14 0v7Z" /><Circle cx="12" cy="14" r="2.2" fill="currentColor" stroke="none" /></>
  ),
  'milk': (
    <><Path d="M9 3h6v3l2 3v11H7V9l2-3Z" /><Path d="M7 13h10" /></>
  ),
  'minus': (
    <><Path d="M5 12h14" /></>
  ),
  'more': (
    <><Circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none" /><Circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" /><Circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none" /></>
  ),
  'mortality': (
    <><Path d="M7 20v-7a5 5 0 0 1 10 0v7" /><Path d="M3 20h18" /><Path d="M12 12v5" /></>
  ),
  'mower': (
    <><Path d="M4 10h13v6H4Z" /><Circle cx="7" cy="19" r="1.9" /><Circle cx="14" cy="19" r="1.9" /><Path d="M17 10l4-5" /></>
  ),
  'needs-a-look': (
    <><Path d="M12 3 22 20H2Z" /><Path d="M12 9.5v4.5" /><Circle cx="12" cy="17" r="1.1" fill="currentColor" stroke="none" /></>
  ),
  'nest-box': (
    <><Path d="M4 20v-6a8 8 0 0 1 16 0v6" /><Circle cx="8.5" cy="17" r="1.6" /><Circle cx="12" cy="17" r="1.6" /><Circle cx="15.5" cy="17" r="1.6" /></>
  ),
  'offline': (
    <><Circle cx="12" cy="12" r="9" /><Path d="M5.8 18.2 18.2 5.8" /></>
  ),
  'parts': (
    <><Path d="M12 3 20 7.5v9L12 21 4 16.5v-9Z" /><Path d="M9 12h6" /></>
  ),
  'photo': (
    <><Path d="M3 8h18v12H3Z" /><Path d="M9 8V5h6v3" /><Circle cx="12" cy="14" r="3.4" /></>
  ),
  'plus': (
    <><Path d="M12 5v14M5 12h14" /></>
  ),
  'pump': (
    <><Circle cx="11" cy="12" r="5" /><Path d="M11 7V3" /><Path d="M16 12h5" /><Path d="M3 20h18" /></>
  ),
  'saved': (
    <><Circle cx="12" cy="12" r="9" /><Path d="M8 12.5 11 15.5 16.5 9" /></>
  ),
  'search': (
    <><Circle cx="10.5" cy="10.5" r="6" /><Path d="M15 15l5.5 5.5" /></>
  ),
  'season': (
    <><Circle cx="12" cy="10" r="3.6" /><Path d="M12 3v2M4.5 10H2.5M21.5 10h-2M6 4.5l1.6 1.6M16.4 6.1 18 4.5" /><Path d="M3 18h18" /></>
  ),
  'sending': (
    <><Circle cx="12" cy="12" r="9" /><Path d="M12 16.5V8" /><Path d="M8.5 11.5 12 8l3.5 3.5" /></>
  ),
  'service': (
    <><Circle cx="8" cy="8" r="4.2" /><Path d="M10.8 10.8 20 20" /></>
  ),
  'settings': (
    <><Path d="M3 7h18M3 12h18M3 17h18" /><Rect x="6" y="5" width="4" height="4" fill="currentColor" stroke="none" /><Rect x="14" y="10" width="4" height="4" fill="currentColor" stroke="none" /><Rect x="9" y="15" width="4" height="4" fill="currentColor" stroke="none" /></>
  ),
  'sign-out': (
    <><Path d="M4 20V11a6 6 0 0 1 12 0" /><Path d="M4 20h9" /><Path d="M15 12h6" /><Path d="M18.5 9.5 21 12l-2.5 2.5" /></>
  ),
  'stock': (
    <><Path d="M3 20v-7a9 7 0 0 1 18 0v7" /><Path d="M9 20v-4a3 3 0 0 1 6 0v4" /></>
  ),
  'sun-mode': (
    <><Circle cx="12" cy="12" r="4.4" /><Path d="M12 2v2.6M12 19.4V22M2 12h2.6M19.4 12H22M5 5l1.9 1.9M17.1 17.1 19 19M19 5l-1.9 1.9M6.9 17.1 5 19" /></>
  ),
  'today': (
    <><Path d="M4 20V11a8 8 0 0 1 16 0v9" /><Path d="M2 21h20" /><Circle cx="16" cy="15" r="1" fill="currentColor" stroke="none" /></>
  ),
  'tractor': (
    <><Path d="M6 8h12v5H6Z" /><Circle cx="8" cy="17" r="3.4" /><Circle cx="17.5" cy="18" r="2.4" /></>
  ),
  'try-again': (
    <><Path d="M20.5 12a8.5 8.5 0 1 1-3.2-6.6" /><Path d="M21 4v4.5h-4.5" /></>
  ),
  'waiting': (
    <><Circle cx="12" cy="12" r="9" /><Path d="M12 7v5.5l4 2" /></>
  ),
  'waterer': (
    <><Path d="M3 10v4a5 5 0 0 0 5 5h8a5 5 0 0 0 5-5v-4Z" /><Path d="M6.5 13.5h11" /></>
  ),
  'withdrawal': (
    <><Ellipse cx="12" cy="13.5" rx="6.2" ry="7.8" /><Path d="M6.5 19.5 17.5 7.5" /></>
  ),
};

export interface IconProps {
  name: IconName;
  /** 20 in chips, 24 default, 30 in tabs, 56 in empty states. */
  size?: number;
  /** Thinner at 56, per the handoff — a 2px stroke gets heavy when scaled up. */
  strokeWidth?: number;
  /**
   * What `currentColor` resolves to. Required rather than defaulted: RN has no
   * inheritance to fall back on, so a missing colour is a black icon on a dark
   * wall, and a default here would hide that at review time.
   */
  color: string;
}

export function Icon({
  name,
  size = 24,
  strokeWidth = size >= 48 ? 1.6 : 2,
  color,
}: IconProps): React.ReactElement {
  return (
    <Svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      color={color}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      {PATHS[name]}
    </Svg>
  );
}
