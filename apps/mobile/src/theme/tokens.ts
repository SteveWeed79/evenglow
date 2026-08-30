/**
 * Evenglow design tokens — UX-SPEC §2, as data.
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
 * **The arch, and then the arch itself.** `--arch` was an *elliptical* radius —
 * half the width across, a fixed 32 down — which RN's circular-only
 * `borderRadius` cannot express, so the motif was drawn rather than styled.
 * The motif has since been removed: it grew with the surface, so a wide card
 * got a 500-by-32 head that read as a warped top edge rather than a doorway.
 *
 * The drawing survived it. `components/Surface.tsx` paints a rounded rectangle
 * a style could have given, because the lamp glow is a radial gradient clipped
 * to the card and RN has no styled form of one. `SURFACE` below is that
 * geometry, not a style.
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
   * Secondary sentences take {@link inkQuiet}, not this and not `ink`.
   * `tests/unit/contrast.test.ts` holds the floors; it cannot tell a label
   * from a sentence, so that part is a rule rather than a gate.
   */
  muted: string;
  /**
   * Prose that is secondary and still prose.
   *
   * ## The gap this fills
   *
   * There were two text tokens and a rule that `muted` may never carry a
   * sentence — so every sentence in the app, from the hero subtitle to a field
   * hint to a confirmation, rendered at `ink`'s 12.6–18.9:1. One volume for
   * all prose. The instruction to "earn quietness from size and position
   * instead" is real advice and it is not enough on its own: at one colour,
   * every screen reads equally loud, which is a large part of what
   * `docs/DESIGN-BRIEF.md` §4 calls "everything is one shape and one speed".
   *
   * ## Why this does not touch R7
   *
   * R7 is a 7:1 **floor** on body text, and `ink` sits at 1.8–2.7× it. There
   * was always room for a second sentence tier underneath — nothing in the
   * rule asked for a two-colour palette, and nothing here lowers the floor.
   * These measure 7.8–13.4:1 on the worse of the two surfaces, so this is
   * secondary prose that is still comfortably AAA.
   *
   * ## Why these exact values
   *
   * Each is its own theme's `ink` walked toward its own `ground` until the
   * worse surface reaches the **geometric mean of that theme's `ink` and
   * `muted`** — the perceptual midpoint between the tier above and the tier
   * below. Derived along that line rather than picked, so the tier keeps the
   * palette's hue instead of dropping neutral grey into a warm interface.
   *
   * A fixed number would have been wrong, and the test caught it. Bright sun's
   * `muted` is **9.70:1** — that theme raises every tier, so a flat 7.2 target
   * put "quiet prose" *below* the label tier and would have rendered a hint
   * fainter than the word labelling it. Deriving from each theme's own pair
   * keeps `ink` > `inkQuiet` > `muted` true in all three.
   */
  inkQuiet: string;
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
  /**
   * Lamp glow, as an SVG RadialGradient stop — RN has no radial-gradient.
   *
   * **`null` on the two light themes, and that is the whole point of the
   * token being nullable.** A warm wash over a near-white card darkens it
   * toward the wall's own tone, so on daylight and bright sun the light made
   * a card *harder* to pick out than no light at all: separation fell from
   * 1.222 to 1.064 and from 1.180 to 1.031, the second of which is a card top
   * indistinguishable from the wall behind it. The glow only adds where the
   * surface is darker than the light, which is lamplight and nowhere else.
   *
   * Those two themes take the luminance step instead — see their grounds.
   */
  glow: string | null;
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
/**
 * Sun joined daylight when its ground stopped being white.
 *
 * `#6b8f52` measured 3.64:1 on the old near-white sun ground and 3.02:1 on the
 * cream one that replaced it — a mark sitting on the 3:1 floor itself, in the
 * theme that exists for a screen in a field at noon. The darker cut restores
 * the margin at 3.71:1. Same reasoning as daylight's, and now the same value:
 * a light ground needs a darker leaf.
 */
const LEAF = { daylight: '#61824b', lamplight: '#6b8f52', sun: '#61824b' } as const;

export const THEMES: Record<ThemeName, Theme> = {
  daylight: {
    /**
     * **Both surfaces moved, in the end, and the wall moved second.**
     *
     * The card lifted first, on the reasoning that loam's quiet tier is 4.82:1
     * on the ground against a 4.5 floor — 0.32 of headroom, so darkening the
     * wall looked like the expensive direction. That bought 1.222:1, which is
     * not a visible edge, and the glow that was supposed to finish the job made
     * it worse here rather than better (1.064 — see `glow`).
     *
     * So the wall spends what headroom there is, and there is very little:
     * `#ebe4d0` takes the card to **1.245** from 1.222. `muted` lands at 4.73
     * and `lanternInk` at 4.62, both against 4.5 floors, and it is the brass
     * rather than the label that runs out first — a fact the suite had to point
     * out, because the search that picked this value did not think to ask it.
     *
     * That is the end of the road in this theme. Daylight's card is separated
     * by its 2px border far more than by its luminance, and no rearrangement of
     * these two surfaces changes that.
     */
    ground: '#ebe4d0', raised: '#fffdf3', ink: '#241c14', muted: '#6e6152',
    /** 8.08:1 on ground, 9.88:1 on raised — between ink's 13.47 and muted's 4.82. */
    inkQuiet: '#484136',
    lantern: '#e9b23c',
    /** 5.76:1 on raised, 4.71:1 on ground. */
    lanternInk: '#8a5b00',
    /** 8.71:1 on the brass fill. */
    lanternOn: '#241c14',
    leaf: LEAF.daylight,
    ...ACCENTS,
    border: 'rgba(36,28,20,0.22)', borderWidth: 2,
    alertTint: '#f3e2d8', scrim: 'rgba(36,28,20,0.55)', glow: null,
    worn: 'rgba(255,255,255,0.7)', shade: 'rgba(36,28,20,0.06)',
  },
  lamplight: {
    /**
     * **The wall deepens; the card stays put.** On a dark theme every ink is
     * at its worst against `raised` — the lighter of the two — so darkening
     * the ground moves nothing that is measured, and lifting the card would
     * move all of it. Reported off the tablet as a screen of cards that read
     * as one brown field: at `#201913` the two were 1.13:1 apart, which is a
     * boundary only the hairline was drawing.
     */
    ground: '#16110c', raised: '#2c2319', ink: '#f0e7d5', muted: '#9c8e7a',
    /** 9.52:1 on ground, 7.83:1 on raised — between ink's 12.56 and muted's 4.82. */
    inkQuiet: '#c0b8a8',
    lantern: '#e9b23c',
    /** 8:1 on raised — brass on a dark wall needs no darkening. */
    lanternInk: '#e9b23c',
    /** 8.71:1 on the brass fill — the same fill as daylight. */
    lanternOn: '#241c14',
    leaf: LEAF.lamplight,
    ...ACCENTS,
    border: 'rgba(240,231,213,0.22)', borderWidth: 2,
    alertTint: '#372620', scrim: 'rgba(0,0,0,0.6)', glow: 'rgba(233,178,60,0.34)',
    worn: 'rgba(240,231,213,0.12)', shade: 'rgba(0,0,0,0.25)',
  },
  sun: {
    /**
     * **The worst of the three, and the theme it matters most in.** White paper
     * on off-white paper was 1.02:1 — a card with no edge but its border,
     * outdoors, in the theme built for reading a screen in a field. `raised` is
     * already white and has nowhere to go, so the ground takes the step.
     *
     * It went to `#f2ecdb` first, for 1.180, and again to `#ece5d3` for
     * **1.256** once the glow was found to be subtracting here rather than
     * adding — a warm wash over white measured 1.031 against the wall, which is
     * no edge at all.
     *
     * This theme has more room than the other two in its text tiers — `muted`
     * is 7.86:1 against a 4.5 floor — and none of that is what stops it.
     * **`lanternInk` is**: the readable brass is on a 4.5 floor of its own and
     * reads 4.67 here, so about one more step exists and then the brass label
     * goes before any sentence does. Worth knowing before anyone tries to walk
     * this ground darker again.
     */
    ground: '#ece5d3', raised: '#ffffff', ink: '#14100a', muted: '#4a4238',
    /** 11.59:1 on ground, 13.68:1 on raised — between ink's 16.06 and muted's 8.36. */
    inkQuiet: '#312d27',
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
    alertTint: '#fdeeea', scrim: 'rgba(20,16,10,0.55)', glow: null,
    worn: 'rgba(255,255,255,0.9)', shade: 'rgba(20,16,10,0.08)',
  },
};

/**
 * Type.
 *
 * Variable-font axes cannot be set in RN, so every face here ships as a static
 * instance cut from its variable original and is referenced by family name —
 * Fraunces at SOFT 100 / WONK 1, Recursive at MONO 1 / CASL 1. `fonts.ts` says
 * why each coordinate is what it is and `scripts/cut-fonts.py` reproduces them.
 *
 * The faces are not registered yet; until `expo-font` loads them RN falls back
 * to the system face, which is visible on purpose rather than hidden behind a
 * resolved default.
 */
export const FONTS = {
  display: 'Fraunces-Opsz30Soft100Wonk1-Bold',
  body: 'AlegreyaSans-Regular',
  bodyBold: 'AlegreyaSans-Bold',
  data: 'RecursiveMonoCasual-Medium',
  /**
   * The same face, cut bold. Used where a mono label has to carry emphasis
   * that colour alone does not — the tab you are standing in, most of all.
   *
   * A separate family rather than `fontWeight: 'bold'` because Android resolves
   * a named custom family to exactly one file: the weight prop is ignored and
   * the label silently stays regular, which is the failure this token exists
   * to prevent.
   */
  dataBold: 'RecursiveMonoCasual-Bold',
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
 * The widest the reading column is allowed to get.
 *
 * ## Why this is not a nice-to-have
 *
 * **The app rotates on a tablet, and this cap is what stops that being a mess.**
 *
 * This paragraph used to say the app *already* rotated everywhere, on the
 * grounds that an app targeting Android SDK 36 — which Expo SDK 57 does — has
 * its orientation, aspect-ratio and resizability restrictions ignored on any
 * display 600dp or wider. That behaviour is real but it is **Android 16's**,
 * not the target level's: the OS on the device is what ignores the manifest, so
 * a tablet running anything earlier honoured `orientation: "portrait"` in full.
 * The tablet this was found on reports API 35 and would not turn at all.
 *
 * It turns now: the manifest no longer locks, and `theme/rotation.ts` puts the
 * lock back at runtime for screens under 600dp only — so a phone is upright and
 * a tablet is not. Which means the cap below has gone from insurance to
 * load-bearing, and it is the tablet it is bearing.
 *
 * Nothing else in the app bounded its width. A row that reads
 * "Chickens · EGGS · 6 HEAD · 4" at 430dp becomes the same words at 1280dp
 * with a metre of plaster between them — not broken, just no longer a design.
 *
 * ## Why 600
 *
 * The screens were drawn at 375–430dp. 600 is ~1.4× that: wide enough that a
 * tablet is visibly using its room, narrow enough that the proportions the app
 * was designed in survive. It is also the exact figure Android uses to decide
 * a display is "large", which makes the two numbers say the same thing — below
 * it the app fills the screen, at or above it the column stops growing.
 *
 * Applied to the status bar as well as the content, and that pairing is the
 * point: capping only the content would leave the lamp and the settings gear
 * out at the far edge of a 1280dp screen, pointing at a column in the middle.
 *
 * ## What the column is not
 *
 * It is a **measure**, not a container. 600dp of 17dp body text is 70–80
 * characters, which is the top of the range a line can be read at — so the
 * answer to a window wider than this is never a wider column. It is more
 * columns, and the rest of the numbers below are what makes that sayable.
 *
 * See `theme/window.ts` for the sizes the app is allowed to notice, and
 * `docs/LANDSCAPE-PLAN.md` for the arrangement they are for.
 */
export const LAYOUT = {
  /** The measure. Never widen it; add a pane instead. */
  column: 600,
  /**
   * Between two panes, and outside the pair.
   *
   * One number for both because they are the same gap seen from either side —
   * and 24 is `SPACE.lg + 4` rather than a sixth space token, since the scale
   * has no 24 and this is the only place that wants one.
   */
  spacer: 24,
  margin: 24,
  /**
   * The supporting pane.
   *
   * The floor is what a due row plus its "2 days late" needs before it starts
   * wrapping every line. The ceiling is the same argument as the column's: an
   * unbounded aside on a 1600dp screen is the metre of plaster again, just in
   * a second column.
   */
  aside: { min: 320, max: 480 },
  /**
   * The widest the app's content ever gets — column, spacer and a full aside.
   *
   * Used by screens with no aside that still want the room: the hub grids and
   * the charts. Sharing the number is the point. A hub laid out to 1104 and a
   * two-pane screen laid out to 1104 do not jump about relative to each other
   * when you move between them, which they would if each picked its own width.
   */
  wide: 600 + 24 + 480,
  /**
   * The narrowest a grid cell may be before the grid drops a column.
   *
   * Sized for a `Row` — a title and a sentence of detail under it — rather
   * than for a card, because Row is what the hubs are made of and it is the
   * one that reads badly narrow. At `wide` this yields two columns and keeps
   * yielding two however large the display gets, which is deliberate: three
   * columns of hub rows is a directory, not a hub.
   */
  cell: 400,
  /**
   * The navigation rail.
   *
   * **Chrome that eats width**, which is why it is a token the pane arithmetic
   * can see rather than a number invented at the point of use.
   *
   * 96 rather than Material's 80, and the reason is that this bar has no
   * icons. A rail is 80 wide because it holds a 24dp glyph with a short word
   * under it; ours holds the word alone, and `tab-marks.ts` caps a name at
   * eight characters — 8 × the data face at `TYPE.label` plus its tracking is
   * about 70dp, which does not fit inside 80 less padding. `TabMark`'s comment
   * records this bar clipping its labels twice already, both times because a
   * word was put in a box measured for something else. Not a third time.
   *
   * The trade still favours the rail: 96dp of width for the 88dp of height the
   * bottom bar was spending, on a landscape tablet that is *medium* height and
   * *large* width.
   */
  rail: 96,
} as const;

/**
 * The card face's geometry — used by `<Surface>`, which draws it.
 *
 * `radius` matches `RADII.softHead` deliberately: with the arch gone every
 * surface in the app is the same rounded rectangle, and a painted card sitting
 * beside a styled one at a different radius is the seam this removes.
 *
 * `glowHead` is how far down the face the lamp reaches, not a radius. It was
 * the arch's `spring` — the depth of the head the light came through — and it
 * keeps that value because the light kept its size when the curve went.
 */
export const SURFACE = {
  radius: 12,
  /**
   * How far down the face the lamp reaches, from the top edge. Not a radius.
   *
   * **This is the number that has to stay under a surface's top padding**, and
   * it did not when the glow first went onto every card: the light was centred
   * 11 in and reached 61 down, so a `muted` label at `SPACE.lg` sat in 0.257 of
   * brass and measured **2.73:1 against a 4.5 floor**. `ink` was 7.11 — on R7's
   * floor rather than the 12.56 it has on the bare card.
   *
   * The fix is geometry rather than dimming. Centred on the top edge and
   * stopping short of the content, the light is *brighter* where it does the
   * work — 2.62:1 card-to-wall against the 2.38 the deeper wash managed — and
   * costs the text nothing at all, because it has faded to zero before the
   * first line begins. A lamp above the card rather than a haze inside it.
   */
  glowReach: 16,
  /**
   * The Tally's, which can be deeper because its content starts at
   * `SPACE.xl + SPACE.lg` rather than `SPACE.lg`. Same rule, more room: 44
   * still fades out before 52.
   */
  glowReachTally: 44,
} as const;

export const RADII = {
  /** Chips and pills. */
  pill: 999,
  /**
   * Every surface that is styled rather than painted. `<Surface>` draws the
   * same radius from `SURFACE.radius`; these two are one shape in two places
   * because a gradient cannot be styled and a hairline need not be drawn.
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
