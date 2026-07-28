/**
 * Steading design tokens — UX-SPEC §2, ported from `apps/app/src/styles.css`.
 *
 * These are decisions, not features. The same numbers and the same names as
 * the CSS custom properties they came from, so a change to the spec lands in
 * one place per platform rather than being rediscovered per screen.
 *
 * Do not add colours, radii, or type steps here without changing the spec.
 *
 * ## What did not survive the port, and what to do instead
 *
 * **The arch.** `--arch` is an *elliptical* border radius — `50% 50% .5rem
 * .5rem / 2rem 2rem .5rem .5rem` — and that ellipse is the whole motif: a
 * wide shallow head sitting on straight jambs. React Native has only circular
 * per-corner radii, so there is no token here that reproduces it. Anything
 * that needs a real arch draws one, and `react-native-svg` is a dependency for
 * exactly that reason. `radii.softHead` below is a rounded rectangle for
 * things that were never arches; it is NOT the motif and must not be used as
 * a stand-in for one.
 *
 * **`color-mix()` and `--plaster`.** Mixed colours are resolved to literals
 * here. The plaster tooth was an SVG turbulence filter blended at soft-light;
 * on RN that becomes a tiling image or an SVG layer, and it is deferred to the
 * design pass rather than faked with an opacity.
 *
 * **Shadows.** `--lift` was two layered shadows. Android renders a single
 * elevation, so `elevation` carries the Android side and the iOS shadow
 * properties carry the other. They are one token so they cannot drift.
 */

/** Accents. Shared across every mode — brass, garden, orchard. */
export const accent = {
  /** Primary action. Brass under lamplight. */
  lantern: '#E9B23C',
  /** Complete, synced, healthy. */
  leaf: '#6B8F52',
  /** Overdue, withdrawal active, conflict. */
  rowan: '#C4442C',
  /** Queued / offline. Plum — calm, never alarming. */
  damson: '#8A6484',
  /** Hardware. The one piece of ironmongery in the interface. */
  brass: '#C99A34',
} as const;

export type Surfaces = {
  /** The wall behind everything. Plaster, gold-green — not cream. */
  ground: string;
  /** Card surfaces. */
  raised: string;
  /** Body text. Deep loam brown in daylight, candle-warm off-white at night. */
  ink: string;
  /** Secondary text, dividers. */
  muted: string;
  /** Hairline colour, pre-mixed because RN has no `color-mix()`. */
  line: string;
  /** The lantern, adjusted where a mode needs the contrast. */
  lantern: string;
};

export const daylight: Surfaces = {
  ground: '#EDE6D2',
  raised: '#F5F0E1',
  ink: '#241C14',
  muted: '#6E6152',
  line: '#C0B49F',
  lantern: accent.lantern,
};

/** The burrow at dawn. Warm dark, never grey — that distinction is the point. */
export const lamplight: Surfaces = {
  ground: '#201913',
  raised: '#2C2319',
  ink: '#F0E7D5',
  muted: '#9C8E7A',
  line: '#4A3F33',
  lantern: accent.lantern,
};

/**
 * Bright-sun override. Warmth yields to legibility, never the reverse.
 *
 * Not wired to a control yet — the daylight/lamplight toggle is, this is not.
 * It is here because the token set is the thing being ported, and leaving one
 * mode behind is how a set stops being a set.
 */
export const sun: Surfaces = {
  ground: '#FFFDF6',
  raised: '#FFFFFF',
  ink: '#14100A',
  muted: '#4A4238',
  line: '#14100A',
  lantern: '#A66F00',
};

/**
 * Type.
 *
 * Fraunces carries the warmth, Alegreya Sans carries the load, IBM Plex Mono
 * carries numbers. The families are named but not yet loaded — `expo-font`
 * lands with the design pass, and until then RN falls back to the system face,
 * which is the same failure the web build had for weeks. It is visible here on
 * purpose rather than hidden behind a resolved default.
 */
export const font = {
  display: 'Fraunces',
  body: 'AlegreyaSans',
  data: 'IBMPlexMono',
} as const;

/** The scale. Six steps, and 17px is the floor — never smaller outdoors. */
export const type = {
  /** The tally count. Clamped in CSS; a fixed large step here. */
  tally: 88,
  hero: 32,
  title: 24,
  /** The one line under a heading. */
  lede: 19,
  body: 17,
  /** Small caps, tracked, monospace. */
  label: 13,
} as const;

/** Coziness never costs a millimetre. */
export const tap = {
  min: 56,
  primary: 64,
  gap: 12,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 20,
  xl: 32,
} as const;

export const radii = {
  /**
   * For surfaces that were never arches — chips, inputs, the sync pill.
   * See the header: this is not the motif.
   */
  softHead: 12,
  pill: 999,
} as const;

/** Stroke width the icon set is drawn at (24×24 grid). */
export const stroke = 2;

/**
 * Elevation, as one token per level so the Android and iOS halves cannot
 * drift. Warm rather than grey: a shadow tinted with the ink colour reads as
 * a card lifted off plaster, while black at low opacity reads as a web page
 * from 2008.
 */
export type Lift = {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
};

export const lift: Lift = {
  shadowColor: '#241C14',
  shadowOpacity: 0.14,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
};

export const liftHigh: Lift = {
  shadowColor: '#241C14',
  shadowOpacity: 0.2,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 10 },
  elevation: 8,
};
