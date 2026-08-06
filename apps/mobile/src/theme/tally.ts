import { TYPE } from './tokens';

/**
 * How big the tally numeral is, given the window.
 *
 * ## The bug this replaces
 *
 * It was `Math.min(width, height) * TYPE.tally` and nothing else — a fraction
 * of the shorter edge, chosen because `clamp()` has no RN form and because the
 * numeral should be the same size in the hand whichever way the phone is held.
 * That reasoning is right and it is not sufficient, because the shorter edge
 * stops being the constraint the moment the screen is not a portrait phone:
 *
 * - **A 375pt phone** gives `375 × 0.22 = 82`, which is the size the design
 *   was drawn at and the reason nobody caught this.
 * - **An iPad at 834 × 1194** gives **183px**. Nothing else on the screen grew,
 *   so the numeral is not larger — it is out of scale with everything around it.
 * - **A phone in landscape at 932 × 430** gives **94px on a screen 430pt tall**.
 *   The shorter edge is now the *height*, so the fraction that was a comfortable
 *   fifth of the width becomes almost a quarter of the visible column, and the
 *   tally alone eats the fold.
 *
 * The last one is the real defect: it ships today, Android landscape is one
 * rotation away, and R1 says a daily log is three taps from a cold launch —
 * which it is not if the commit button is below the fold.
 *
 * ## The shape of the fix
 *
 * Three terms, and each one is doing a different job:
 *
 * - `TYPE.tally × shorterEdge` — the original intent. Consistent in the hand.
 * - `TALLY.ofHeight × height` — the term that saves landscape. However wide the
 *   screen is, the numeral cannot take more than a sixth of the column it has
 *   to share with a label, four steppers and a commit button.
 * - `TALLY.min` / `TALLY.max` — the floor keeps it a Tally rather than a
 *   heading on a small phone; the ceiling is what stops a tablet.
 *
 * Pure and here rather than in the component for the same reason `arch.ts` is
 * separate: `Tally.tsx` imports react-native, which does not load in Node, and
 * the sizing is exactly the part that must not regress silently. It regressed
 * silently once already.
 */

export const TALLY = {
  /** Never smaller than this, or it stops reading as the one bold element. */
  min: 64,
  /** Never larger. Past this it is out of scale with the arch around it. */
  max: 112,
  /**
   * The share of the viewport height it may take.
   *
   * The tally sits above a label, four steppers and a commit button, all of
   * which must be reachable without scrolling (R1, R3). 0.17 is what leaves
   * room for them on the shortest screen this runs on.
   */
  ofHeight: 0.17,
} as const;

export function tallySize(width: number, height: number): number {
  const byEdge = Math.min(width, height) * TYPE.tally;
  const byColumn = height * TALLY.ofHeight;

  return Math.max(TALLY.min, Math.min(byEdge, byColumn, TALLY.max));
}
