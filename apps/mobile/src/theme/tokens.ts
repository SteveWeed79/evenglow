/**
 * Steading design tokens — UX-SPEC §2, as data.
 *
 * On the web these live in `:root` and cascade. React Native has no cascade,
 * so they become one object and every component reads them through
 * `ThemeProvider`. Merged from the design handoff's `native/theme.ts`; the
 * per-token comments naming the `color-mix()` expressions they came from are
 * the handoff's and are kept verbatim, because they are the only record of how
 * each literal was derived.
 *
 * **Three themes, not two.** Bright sun is an attribute selector on the web
 * and simply a third theme here. Leaving it out would have quietly dropped the
 * mode that exists for reading a screen in a field at noon.
 *
 * ## What could not survive the port, and what replaced it
 *
 * **The arch.** `--arch` is an *elliptical* radius — half the width across, a
 * fixed 32 down — and RN's `borderRadius` is circular only with no second
 * value. At any width wider than it is tall a circular radius either domes the
 * whole top or flattens into a rounded rectangle, and both were rejected on
 * the web for the same reason. So the motif is drawn: see `components/Arch.tsx`.
 * `ARCH` below is its geometry, not a style.
 *
 * **`color-mix()`.** Resolved to literals, each commented with its expression.
 *
 * **The plaster grain.** `feTurbulence` blended at soft-light has no RN form.
 * It ships as a tiling asset — `components/Plaster.tsx`.
 *
 * **Inset shadows.** RN has none, so the worn top edge is a hairline overlay
 * view — `components/Worn.tsx`.
 */

export type ThemeName = 'daylight' | 'lamplight' | 'sun';

export interface Theme {
  /** The wall behind everything. Plaster, gold-green — not cream. */
  ground: string;
  /** Card surfaces. */
  raised: string;
  /** Body text. Deep loam in daylight, candle-warm off-white at night. */
  ink: string;
  /**
   * Labels and dividers. **Never a sentence.**
   *
   * It measures 4.8–5.4:1 on the two ambient grounds — comfortably past the
   * 4.5:1 AA floor a label needs and short of R7's 7:1, which this app holds
   * itself to because the screen is in the sun. That is the right value for
   * what it is for: a stat label, a unit, a divider, a timestamp. It is the
   * wrong value for anything somebody has to *read*.
   *
   * Secondary sentences take `ink` and earn their quietness from size and
   * position instead. `tests/unit/contrast.test.ts` holds the floors; it
   * cannot tell a label from a sentence, so that part is a rule rather than a
   * gate.
   */
  muted: string;
  /**
   * Primary action, lit lamp, current tab — as a FILL or a lit surface.
   *
   * Brass is a light colour. On the daylight ground it measures 1.55:1, which
   * is below even the 3:1 floor for a graphical object, so it must never carry
   * text or a stroked mark on a pale surface. Use `lanternInk` for that.
   */
  lantern: string;
  /**
   * Brass, darkened until it can be read.
   *
   * `lantern` is a fill, not an ink: #e9b23c on the daylight ground is 1.55:1,
   * under even the 3:1 floor for a graphical object. So anything
   * brass-coloured that carries meaning as a line, a label or an indicator bar
   * uses this instead.
   *
   * Theme-scoped, because on loam the plain lantern already clears 8:1 and
   * darkening it there would only dim the one warm thing in the interface.
   *
   * Values are the design system's (handoff 3.1), not derived here.
   */
  lanternInk: string;
  /**
   * What can be read **on top of** a `lantern` fill.
   *
   * Nine components put a hardcoded `#241c14` on the brass — the primary
   * button, the chips, the toggles, the commit, the armed Done, the month
   * picker. That is right on the two ambient themes, where the fill is bright
   * brass and dark loam sits on it at 8.7:1.
   *
   * **In bright sun it was 3.9:1, which is a failure in the theme that exists
   * to be legible.** Sun darkens the fill to `#a16c00` so the button can be
   * seen as a shape against a white ground at all — and dark ink on a dark
   * fill is the predictable consequence. So the sun theme puts white on it
   * instead, and the choice belongs to the theme rather than to nine files
   * that cannot know which one is active.
   */
  lanternOn: string;
  /** Complete, synced, healthy. */
  leaf: string;
  /** Overdue, withdrawal active, conflict. */
  rowan: string;
  /** Queued / offline — calm, never alarming. */
  damson: string;
  /** color-mix(in oklab, ink 22%, transparent) */
  border: string;
  borderWidth: number;
  /** color-mix(in oklab, rowan 8%, raised) */
  alertTint: string;
  /** color-mix(in oklab, ink 55%, transparent) */
  scrim: string;
  /** Lamp glow, as an SVG RadialGradient stop — RN has no radial-gradient. */
  glow: string;
  /** The highlight on a worn top edge. Was an inset box-shadow. */
  worn: string;
  /** The shade on the bottom edge. The other half of the same inset. */
  shade: string;
}

/**
 * The three accents, which are **graphical objects and never body text**.
 *
 * A rule, a bar, a dot, a border, a filled button. None of them clears R7's
 * 7:1 on any ground and none of them needs to; the floor for a graphical
 * object is 3:1, which is what `contrast.test.ts` holds them to.
 *
 * The one place this bites is a heading tinted to match its own rule — rowan
 * on the lamplight ground is 3.1:1, which is a fine bar and an unreadable
 * sentence. Keep the bar, set the words in `ink`.
 */
const ACCENTS = { rowan: '#c4442c', damson: '#8a6484' } as const;

/**
 * Leaf, which needed darkening on loam and nowhere else.
 *
 * `#6b8f52` measures **2.97:1 on the daylight ground** — under even the 3:1
 * floor for a graphical object, so the "done" tick and the healthy dot were
 * the two marks in the app that could not be relied on to be seen at all. It
 * clears comfortably on both dark grounds and in bright sun.
 *
 * Theme-scoped in the same key rather than given a second token, exactly as
 * `lanternInk` is and for the same reason: one name means one thing, and
 * darkening it everywhere would dim the healthy colour at night to fix a
 * problem it only has in daylight.
 */
const LEAF = { daylight: '#61824b', lamplight: '#6b8f52', sun: '#6b8f52' } as const;

export const THEMES: Record<ThemeName, Theme> = {
  daylight: {
    ground: '#ede6d2', raised: '#f5f0e1', ink: '#241c14', muted: '#6e6152',
    lantern: '#e9b23c',
    /** 5.15:1 on raised, 4.71:1 on ground. */
    lanternInk: '#8a5b00',
    /** 8.71:1 on the brass fill. */
    lanternOn: '#241c14',
    leaf: LEAF.daylight,
    ...ACCENTS,
    border: 'rgba(36,28,20,0.22)', borderWidth: 2,
    alertTint: '#f3e2d8', scrim: 'rgba(36,28,20,0.55)', glow: 'rgba(233,178,60,0.22)',
    worn: 'rgba(255,255,255,0.7)', shade: 'rgba(36,28,20,0.06)',
  },
  lamplight: {
    ground: '#201913', raised: '#2c2319', ink: '#f0e7d5', muted: '#9c8e7a',
    lantern: '#e9b23c',
    /** 8:1 on raised — brass on a dark wall needs no darkening. */
    lanternInk: '#e9b23c',
    /** 8.71:1 on the brass fill — the same fill as daylight. */
    lanternOn: '#241c14',
    leaf: LEAF.lamplight,
    ...ACCENTS,
    border: 'rgba(240,231,213,0.22)', borderWidth: 2,
    alertTint: '#372620', scrim: 'rgba(0,0,0,0.6)', glow: 'rgba(233,178,60,0.30)',
    worn: 'rgba(240,231,213,0.12)', shade: 'rgba(0,0,0,0.25)',
  },
  sun: {
    ground: '#fffdf6', raised: '#ffffff', ink: '#14100a', muted: '#4a4238',
    /**
     * Darkened deliberately: brass on white does not hold 7:1, and a fill that
     * cannot be told from the ground is not a button.
     *
     * Five points darker than the handoff's `#a66f00`, which is what lets
     * white clear 4.5:1 on it. At `#a66f00` the primary button's own label
     * measured 3.9:1 — the worst contrast of the three themes, in the theme
     * that exists for reading a screen in a field at noon.
     */
    lantern: '#a16c00',
    /** 5.87:1 on white. The plain lantern is 4.29 and cannot carry a label. */
    lanternInk: '#8a5b00',
    /** White, not loam: 4.51:1 on the darkened fill, against loam's 4.42. */
    lanternOn: '#ffffff',
    leaf: LEAF.sun,
    ...ACCENTS,
    border: '#14100a', borderWidth: 2,
    alertTint: '#fdeeea', scrim: 'rgba(20,16,10,0.55)', glow: 'rgba(166,111,0,0.16)',
    worn: 'rgba(255,255,255,0.9)', shade: 'rgba(20,16,10,0.08)',
  },
};

/**
 * Type.
 *
 * Fraunces' SOFT and WONK axes cannot be set in RN — variable-font axes are
 * unsupported — so the display face ships as static instances cut at
 * SOFT 30 / WONK 1 and is referenced by family name. The faces are not
 * registered yet; until `expo-font` loads them RN falls back to the system
 * face, which is visible on purpose rather than hidden behind a resolved
 * default.
 */
export const FONTS = {
  display: 'Fraunces-Soft30Wonk1-Bold',
  body: 'AlegreyaSans-Regular',
  bodyBold: 'AlegreyaSans-Bold',
  data: 'IBMPlexMono-Regular',
  /**
   * The same face, cut bold. Used where a mono label has to carry emphasis
   * that colour alone does not — the tab you are standing in, most of all.
   *
   * A separate family rather than `fontWeight: 'bold'` because Android resolves
   * a named custom family to exactly one file: the weight prop is ignored and
   * the label silently stays regular, which is the failure this token exists
   * to prevent.
   */
  dataBold: 'IBMPlexMono-Bold',
} as const;

/**
 * The scale. 17 is the floor — never smaller outdoors.
 *
 * `tally` is a *fraction of the shorter viewport edge*, not a px value:
 * `clamp()` has no RN form, and the tally count is the one thing on the screen
 * that should grow with the device.
 */
export const TYPE = { tally: 0.22, hero: 32, title: 24, lede: 19, body: 17, label: 13 } as const;

/** Coziness never costs a millimetre. dp, not px — already density-independent. */
export const TAP = { min: 56, primary: 64, gap: 12 } as const;

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 20, xl: 32 } as const;

/**
 * The arch's geometry — used by `<Arch>`, which draws it. NOT a border radius.
 *
 * `spring` is the vertical radius of the head; the horizontal radius is always
 * half the width, which is what makes it elliptical and what RN cannot express.
 */
export const ARCH = { spring: 32, foot: 8 } as const;

export const RADII = {
  /** Chips and pills — things that were never arches. */
  pill: 999,
  /**
   * For surfaces that were never arches. This is NOT a stand-in for the motif;
   * anything that should read as a doorway uses `<Arch>`.
   */
  softHead: 12,
} as const;

/** Stroke width the small icon master is drawn at. */
export const STROKE = 2;

/**
 * Elevation, one token per level so the Android and iOS halves cannot drift.
 *
 * Warm rather than grey: a shadow tinted with the ink colour reads as a card
 * lifted off plaster, while black at low opacity reads as a web page from 2008.
 */
export interface Lift {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
}

export const LIFT: Lift = {
  shadowColor: '#241c14',
  shadowOpacity: 0.14,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
};

export const LIFT_HIGH: Lift = {
  shadowColor: '#241c14',
  shadowOpacity: 0.2,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 10 },
  elevation: 8,
};
