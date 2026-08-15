import { LAYOUT, SPACE } from './tokens';

/**
 * How much room the app has, as a name rather than a number.
 *
 * ## The gap this fills
 *
 * The app had exactly one breakpoint — 600 — and used it for two different
 * jobs: `LAYOUT.column`, where the reading column stops growing, and
 * `ROTATES_AT`, where a device is allowed to turn. Both are about Android's
 * compact/medium boundary, and neither says anything about what happens above
 * it. So a 10" tablet in landscape — 1280 × 800, which Android calls a
 * **large-width, medium-height** window — was described by nothing the
 * codebase could say, and rendered a 600dp column with 340dp of plaster on
 * either side. Over half the window was texture.
 *
 * This is the vocabulary. It renders nothing by itself; see
 * `docs/LANDSCAPE-PLAN.md` for what reads it.
 *
 * ## Window, not screen — and the distinction is load-bearing
 *
 * `theme/rotation.ts` reads `Dimensions.get('screen')` deliberately, because
 * whether a *device* may turn is a fact about the display: computed from the
 * window it would unlock a phone that was briefly landscape and then have no
 * way back.
 *
 * Layout is the exact opposite. It must follow the window the app actually
 * occupies, because that is what it has to draw into. A 1280dp tablet split
 * down the middle gives each app 640 — a medium window on a large screen — and
 * a layout that read the screen would confidently lay out two panes in half a
 * tablet. Android's freeform desktop windowing makes the window any width
 * somebody drags it to, and a foldable changes it mid-session.
 *
 * So everything here takes measurements as arguments, `hooks/useWindow.ts`
 * feeds it `useWindowDimensions()`, and the two rules cannot quietly converge
 * on one source.
 *
 * ## Why pure, and here
 *
 * Same reason `tally.ts` and `rotation.ts` are: this is arithmetic, the test
 * suite runs in Node where react-native does not load, and sizing is exactly
 * the sort of thing that regresses silently. `tally.ts` records having
 * regressed silently once already.
 */

/**
 * Android's own width classes, in dp.
 *
 * Not invented here — these are the platform's numbers, so a screen the OS
 * calls large is a screen this app calls large. `expanded` is where Material
 * moves a bottom bar to a navigation rail; `large` is where a 10" tablet in
 * landscape lands.
 */
export const WIDTH = { medium: 600, expanded: 840, large: 1200 } as const;

/**
 * And the height classes, which matter more than they look.
 *
 * A landscape tablet is 800dp tall — *medium*, the tighter of its two classes,
 * while its width is large. That asymmetry is the whole reason the tab bar
 * wants to become a rail: the app is short of exactly the axis it currently
 * spends 88dp of on three words.
 */
export const HEIGHT = { medium: 480, expanded: 900 } as const;

export type WidthClass = 'compact' | 'medium' | 'expanded' | 'large';
export type HeightClass = 'compact' | 'medium' | 'expanded';

export interface WindowClass {
  width: WidthClass;
  height: HeightClass;
  /** Usable content width, insets already taken off. What layout divides up. */
  usable: number;
  /** Whether a supporting pane fits beside the column. See {@link TWO_PANE_AT}. */
  panes: 1 | 2;
}

/**
 * The width at which a second pane fits, derived rather than picked.
 *
 * A number chosen by eye is a number nobody can argue with later. This one is
 * the sum of the things that have to fit, so moving any of its parts moves it
 * and `tests/unit/panes.test.ts` says so:
 *
 * ```
 * 600 column + 24 spacer + 320 aside floor + 24 margin × 2 = 992
 * ```
 *
 * What that yields, once the rail is taking its 80dp of chrome:
 *
 * | Window                  | Usable | Panes |
 * |-------------------------|--------|-------|
 * | 10" landscape, 1280     | 1200   | two   |
 * | 10" portrait, 800       | 800    | one   |
 * | 8" landscape, 1024×600  | 944    | one   |
 * | 1280 split in half, 640 | 640    | one   |
 * | Any phone               | —      | one, and phones do not turn |
 *
 * **The 8" tablet is decided by the rail, and that is worth knowing rather
 * than discovering.** Its 1024 clears this threshold on its own — the rail is
 * what puts it 48dp under. So it is a two-pane window until the rail ships and
 * a one-pane window afterwards, which is why {@link windowClass} takes the
 * chrome as an argument instead of assuming it: the answer has to be able to
 * change when the thing it depends on does. Landing it single is the outcome
 * worth having, because at 600dp tall it is a compact-height window and two
 * panes there would be cramped on both axes at once.
 */
export const TWO_PANE_AT = LAYOUT.column + LAYOUT.spacer + LAYOUT.aside.min + LAYOUT.margin * 2;

export function widthClass(width: number): WidthClass {
  if (width < WIDTH.medium) return 'compact';
  if (width < WIDTH.expanded) return 'medium';
  if (width < WIDTH.large) return 'expanded';
  return 'large';
}

export function heightClass(height: number): HeightClass {
  if (height < HEIGHT.medium) return 'compact';
  if (height < HEIGHT.expanded) return 'medium';
  return 'expanded';
}

/**
 * Everything a layout needs to know, from the window and what is standing in it.
 *
 * Two deductions, and they are not the same kind of thing:
 *
 * **`insets`** is width the app may not draw into at all — a display cutout on
 * the left edge of a tablet in landscape, or the gesture bar. It comes off
 * before anything is classified, because a rule that classified the raw window
 * would promise a pane the safe area cannot hold. `insets.left` and
 * `insets.right` were read nowhere in this app before this function existed:
 * complete in portrait, and wrong the first time a landscape tablet has a
 * cutout.
 *
 * **`chrome`** is width the app is spending on itself — today nothing, and
 * `LAYOUT.rail` once the bar becomes a rail. Passed in rather than assumed,
 * because the caller is the only thing that knows what it is actually drawing,
 * and because an 8" tablet in landscape is a two-pane window without a rail
 * and a one-pane window with one. A constant baked in here would have made
 * that answer un-sayable in one direction or the other.
 *
 * The width *class* is a fact about the window and ignores chrome — a large
 * display is large whatever the app puts in it. `usable` and `panes` are facts
 * about what is left for content, and take both deductions.
 */
export function windowClass(
  width: number,
  height: number,
  {
    insets = { left: 0, right: 0 },
    chrome = 0,
  }: { insets?: { left: number; right: number }; chrome?: number } = {},
): WindowClass {
  const safe = Math.max(0, width - insets.left - insets.right);
  const usable = Math.max(0, safe - chrome);

  return {
    width: widthClass(safe),
    height: heightClass(height),
    usable,
    panes: usable >= TWO_PANE_AT ? 2 : 1,
  };
}

/**
 * How wide the supporting pane gets, given the room.
 *
 * Whatever is left after the column, the spacer and both margins, held between
 * its floor and its ceiling. Above `LAYOUT.wide` the ceiling binds and the
 * surplus goes to the margins instead — so a 1600dp display centres a 1104dp
 * assembly rather than growing a 800dp sidebar.
 */
export function asideWidth(usable: number): number {
  const spare = usable - LAYOUT.column - LAYOUT.spacer - LAYOUT.margin * 2;
  return Math.max(LAYOUT.aside.min, Math.min(spare, LAYOUT.aside.max));
}

/**
 * Columns for a grid of equivalent things, from the width it has to fill.
 *
 * The feed layout, which is the canonical answer to "a list of the same kind of
 * thing in a wide window". Derived from a minimum cell rather than from a
 * breakpoint so it cannot disagree with itself: one column is whatever is too
 * narrow for two.
 *
 * `gap` is included in the arithmetic because n columns have n−1 gaps between
 * them, and a version that forgot said two columns fit exactly at `2 × cell`
 * and then overflowed by one gap.
 */
export function columnsFor(width: number, cell: number = LAYOUT.cell, gap: number = SPACE.md): number {
  return Math.max(1, Math.floor((width + gap) / (cell + gap)));
}

/**
 * The width one cell of that grid gets.
 *
 * Returned rather than left to `flexBasis: '50%'`, because a percentage basis
 * and a `gap` on the same row overflow: the percentages already add to 100 and
 * the gaps are extra. RN has no `calc()`, so the division happens here.
 */
export function cellWidth(width: number, columns: number, gap: number = SPACE.md): number {
  return (width - gap * (columns - 1)) / columns;
}
