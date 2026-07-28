/**
 * The Steading icon set — 24×24, stroke 2, square caps, mitred joins.
 *
 * Drawn to the brief in the design handoff, and the brief is the reason this
 * is one file of geometry rather than a dependency. Every icon is built from
 * the same grid and the same constructive rule: **arched things are places you
 * go or keep** — the door, the byre, the nest box, the milestone — and
 * **squared things are tools you use** — the nut, the tractor, the wrench.
 * That contrast carries meaning, so do not soften it by adding a rounded
 * icon from somewhere else.
 *
 * `currentColor` throughout and no literal colour anywhere, which is what lets
 * one set serve daylight, lamplight and bright-sun without a second asset.
 *
 * Two of the fifty-six are not here: `basic-full` and `streak-plant`. They
 * were not recoverable from the handoff, and drawing them from the prose
 * description would produce something that does not match the rest of the
 * hand. They belong with the Basic/Full toggle and the charm layer, neither
 * of which is built.
 *
 * `lamp-lit` and `withdrawal` are derived rather than extracted, exactly as
 * the brief defines them: lamp-lit is lamp-unlit with the glass filled and
 * nothing else changed, and withdrawal is the egg ellipse with one slash.
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
  | 'growing'
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
    <><path d="M4 20V11a8 8 0 0 1 16 0v9" /><path d="M2 21h20" /></>
  ),
  'back': (
    <><path d="M15 4 8 12l7 8" /></>
  ),
  'basket': (
    <><path d="M4 11h16l-2.2 9H6.2Z" /><path d="M7.5 11a4.5 4.5 0 0 1 9 0" /><path d="M5 15h14" /></>
  ),
  'bench': (
    <><path d="M3 10h18" /><path d="M5.5 10v10M18.5 10v10" /><path d="M9 10V7a3 3 0 0 1 6 0v3" /></>
  ),
  'check': (
    <><path d="M4 12.5 9.5 18 20 6.5" /></>
  ),
  'close': (
    <><path d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5" /></>
  ),
  'copy': (
    <><path d="M4 4h11v11H4Z" /><path d="M8 20h12V8" /></>
  ),
  'date-due': (
    <><rect x="4" y="6" width="16" height="14" rx="1" /><path d="M9 6V3M15 6V3" /><path d="M4 11h16" /></>
  ),
  'diagnostics': (
    <><rect x="3" y="5" width="18" height="14" rx="1" /><path d="M3 10h18" /><path d="M7 14h5" /></>
  ),
  'discard': (
    <><path d="M5 7h14v13H5Z" /><path d="M3 7h18" /><path d="M9.5 7V4h5v3" /><path d="M10 11v5M14 11v5" /></>
  ),
  'edit': (
    <><path d="M4 20h4L19 9l-4-4L4 16Z" /><path d="M14 6l4 4" /></>
  ),
  'egg': (
    <><ellipse cx="12" cy="13.5" rx="6.2" ry="7.8" /></>
  ),
  'export': (
    <><path d="M4 15v5h16v-5" /><path d="M12 16V4" /><path d="M8.5 7.5 12 4l3.5 3.5" /></>
  ),
  'feed': (
    <><path d="M7 9h10v11H7Z" /><path d="M9 9l1-3h4l1 3" /><path d="M7 14h10" /></>
  ),
  'forward': (
    <><path d="M9 4l7 8-7 8" /></>
  ),
  'fuel': (
    <><rect x="5" y="8" width="11" height="12" rx="1" /><path d="M10 8V5h4v3" /><path d="M16 11h4v7" /></>
  ),
  'growing': (
    <><path d="M3 21h18" /><path d="M12 21V9" /><path d="M12 15Q6 15 6 11.5Q11 11.5 12 15" /><path d="M12 11.5Q18 11.5 18 8Q13 8 12 11.5" /></>
  ),
  'head-count': (
    <><circle cx="7" cy="10" r="2.6" /><circle cx="17" cy="10" r="2.6" /><circle cx="12" cy="16.5" r="2.6" /></>
  ),
  'hour-meter': (
    <><rect x="3" y="8" width="18" height="9" rx="1" /><path d="M8 11v3M12 11v3M16 11v3" /></>
  ),
  'hung-lantern': (
    <><path d="M12 2v3" /><path d="M8 17v-4a4 4 0 0 1 8 0v4" /><path d="M6.5 20h11" /><path d="M8 17h8" /></>
  ),
  'in-water': (
    <><path d="M12 3.5 17 12a5 5 0 1 1-10 0Z" /></>
  ),
  'injected': (
    <><rect x="9" y="5" width="6" height="12" transform="rotate(-45 12 11)" /><path d="M3.5 20.5 7 17" /><path d="M13 3.5 17.5 8" /></>
  ),
  'iron': (
    <><path d="M12 3 20 7.5v9L12 21 4 16.5v-9Z" /><circle cx="12" cy="12" r="3.4" /></>
  ),
  'lamp-lit': (
    <><path d="M12 2v2.5" /><path d="M6 19v-5a6 6 0 0 1 12 0v5" /><path d="M4.5 19h15" /><circle cx="12" cy="14" r="2.2" fill="currentColor" stroke="none" /></>
  ),
  'lamp-unlit': (
    <><path d="M12 2v2.5" /><path d="M6 19v-5a6 6 0 0 1 12 0v5" /><path d="M4.5 19h15" /><circle cx="12" cy="14" r="2.2" /></>
  ),
  'meat': (
    <><path d="M4 15h16v5H4Z" /><path d="M8 15v-3a4 4 0 0 1 8 0v3" /></>
  ),
  'medication': (
    <><path d="M8 8h8v12H8Z" /><path d="M10 8V4h4v4" /><path d="M8 13h8" /></>
  ),
  'milestone': (
    <><path d="M5 20v-7a7 7 0 0 1 14 0v7Z" /><circle cx="12" cy="14" r="2.2" fill="currentColor" stroke="none" /></>
  ),
  'milk': (
    <><path d="M9 3h6v3l2 3v11H7V9l2-3Z" /><path d="M7 13h10" /></>
  ),
  'minus': (
    <><path d="M5 12h14" /></>
  ),
  'more': (
    <><circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none" /></>
  ),
  'mortality': (
    <><path d="M7 20v-7a5 5 0 0 1 10 0v7" /><path d="M3 20h18" /><path d="M12 12v5" /></>
  ),
  'mower': (
    <><path d="M4 10h13v6H4Z" /><circle cx="7" cy="19" r="1.9" /><circle cx="14" cy="19" r="1.9" /><path d="M17 10l4-5" /></>
  ),
  'needs-a-look': (
    <><path d="M12 3 22 20H2Z" /><path d="M12 9.5v4.5" /><circle cx="12" cy="17" r="1.1" fill="currentColor" stroke="none" /></>
  ),
  'nest-box': (
    <><path d="M4 20v-6a8 8 0 0 1 16 0v6" /><circle cx="8.5" cy="17" r="1.6" /><circle cx="12" cy="17" r="1.6" /><circle cx="15.5" cy="17" r="1.6" /></>
  ),
  'offline': (
    <><circle cx="12" cy="12" r="9" /><path d="M5.8 18.2 18.2 5.8" /></>
  ),
  'parts': (
    <><path d="M12 3 20 7.5v9L12 21 4 16.5v-9Z" /><path d="M9 12h6" /></>
  ),
  'photo': (
    <><path d="M3 8h18v12H3Z" /><path d="M9 8V5h6v3" /><circle cx="12" cy="14" r="3.4" /></>
  ),
  'plus': (
    <><path d="M12 5v14M5 12h14" /></>
  ),
  'pump': (
    <><circle cx="11" cy="12" r="5" /><path d="M11 7V3" /><path d="M16 12h5" /><path d="M3 20h18" /></>
  ),
  'saved': (
    <><circle cx="12" cy="12" r="9" /><path d="M8 12.5 11 15.5 16.5 9" /></>
  ),
  'search': (
    <><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5.5 5.5" /></>
  ),
  'season': (
    <><circle cx="12" cy="10" r="3.6" /><path d="M12 3v2M4.5 10H2.5M21.5 10h-2M6 4.5l1.6 1.6M16.4 6.1 18 4.5" /><path d="M3 18h18" /></>
  ),
  'sending': (
    <><circle cx="12" cy="12" r="9" /><path d="M12 16.5V8" /><path d="M8.5 11.5 12 8l3.5 3.5" /></>
  ),
  'service': (
    <><circle cx="8" cy="8" r="4.2" /><path d="M10.8 10.8 20 20" /></>
  ),
  'settings': (
    <><path d="M3 7h18M3 12h18M3 17h18" /><rect x="6" y="5" width="4" height="4" fill="currentColor" stroke="none" /><rect x="14" y="10" width="4" height="4" fill="currentColor" stroke="none" /><rect x="9" y="15" width="4" height="4" fill="currentColor" stroke="none" /></>
  ),
  'sign-out': (
    <><path d="M4 20V11a6 6 0 0 1 12 0" /><path d="M4 20h9" /><path d="M15 12h6" /><path d="M18.5 9.5 21 12l-2.5 2.5" /></>
  ),
  'stock': (
    <><path d="M3 20v-7a9 7 0 0 1 18 0v7" /><path d="M9 20v-4a3 3 0 0 1 6 0v4" /></>
  ),
  'sun-mode': (
    <><circle cx="12" cy="12" r="4.4" /><path d="M12 2v2.6M12 19.4V22M2 12h2.6M19.4 12H22M5 5l1.9 1.9M17.1 17.1 19 19M19 5l-1.9 1.9M6.9 17.1 5 19" /></>
  ),
  'today': (
    <><path d="M4 20V11a8 8 0 0 1 16 0v9" /><path d="M2 21h20" /><circle cx="16" cy="15" r="1" fill="currentColor" stroke="none" /></>
  ),
  'tractor': (
    <><path d="M6 8h12v5H6Z" /><circle cx="8" cy="17" r="3.4" /><circle cx="17.5" cy="18" r="2.4" /></>
  ),
  'try-again': (
    <><path d="M20.5 12a8.5 8.5 0 1 1-3.2-6.6" /><path d="M21 4v4.5h-4.5" /></>
  ),
  'waiting': (
    <><circle cx="12" cy="12" r="9" /><path d="M12 7v5.5l4 2" /></>
  ),
  'waterer': (
    <><path d="M3 10v4a5 5 0 0 0 5 5h8a5 5 0 0 0 5-5v-4Z" /><path d="M6.5 13.5h11" /></>
  ),
  'withdrawal': (
    <><ellipse cx="12" cy="13.5" rx="6.2" ry="7.8" /><path d="M6.5 19.5 17.5 7.5" /></>
  ),
};

export interface IconProps {
  name: IconName;
  /** 20 in chips, 24 default, 30 in tabs, 56 in empty states. */
  size?: number;
  /** Thinner at 56, per the handoff — a 2px stroke gets heavy when scaled up. */
  strokeWidth?: number;
  className?: string;
}

export function Icon({
  name,
  size = 24,
  strokeWidth = size >= 48 ? 1.6 : 2,
  className,
}: IconProps): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
