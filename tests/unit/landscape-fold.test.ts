import { describe, expect, it } from 'vitest';
import { SPACE, TAP, TYPE } from '../../apps/mobile/src/theme/tokens';
import { TALLY, tallySize } from '../../apps/mobile/src/theme/tally';

/**
 * What fits above the fold, once the app is allowed to rotate.
 *
 * `app.json` no longer locks portrait, so every screen has to answer a
 * question it never had to before: **is the commit button reachable without
 * scrolling?** R1 says a daily log is three taps from a cold launch, and it is
 * not three taps if the first one is a scroll.
 *
 * ## Why this is arithmetic rather than a screenshot
 *
 * The suite renders against a stubbed react-native, which does not lay out —
 * so nothing here measures a real frame. What it does instead is add up the
 * *tokens* the tally screen is built from, which is the same sum the layout
 * engine will do, and hold that total against the viewport. That catches the
 * thing most likely to go wrong quietly: somebody adds 8dp of breathing room
 * in portrait and pushes landscape further under.
 *
 * The dp are ±20 — safe-area insets and the tab bar vary by device. The
 * *ranking* is not in doubt, and neither is the sign of the landscape result.
 */

/** The vertical stack above and including the commit button, from tokens. */
function budget(width: number, height: number): number {
  const chrome =
    TAP.min / 2 + // status row
    SPACE.lg + // content paddingTop
    TYPE.hero * 1.25 + // hero line
    SPACE.xs + // heading marginBottom
    SPACE.md; // content gap

  const arch =
    SPACE.xl +
    SPACE.lg + // arch paddingTop
    tallySize(width, height) + // the numeral
    SPACE.sm +
    TYPE.label * 1.3 + // gap + unit label
    SPACE.md +
    TAP.min + // steps marginTop + row
    SPACE.lg; // arch paddingBottom

  return chrome + arch + SPACE.md + TAP.primary;
}

/** Usable height after the system chrome a phone actually spends. */
function usable(height: number, { safeTop = 24, safeBottom = 16, tabs = 56 } = {}): number {
  return height - safeTop - safeBottom - tabs;
}

describe('the fold, now that the app rotates', () => {
  it('fits a tally screen in portrait with room to spare', () => {
    // The orientation the app was drawn in. This is the guard that matters
    // day to day: it fails the moment padding grows past what portrait affords.
    expect(budget(430, 932)).toBeLessThan(usable(932));
    expect(budget(360, 640)).toBeLessThan(usable(640));
  });

  it('fits a tablet in either orientation', () => {
    expect(budget(800, 1280)).toBeLessThan(usable(1280));
    expect(budget(1280, 800)).toBeLessThan(usable(800));
  });

  /**
   * **The known limit, written down rather than discovered again.**
   *
   * A phone in landscape cannot show the commit button without a scroll. This
   * asserts the *shortfall* rather than just the failure, so whoever attempts
   * the fix has a number to beat and this test says how close they got.
   *
   * The deficit is **not** structural, which is worth stating because the
   * first draft of this file asserted that it was and was wrong. The stack
   * itself is smaller than a landscape phone; what does not fit is the stack
   * *plus* a tab bar and two safe-area insets. Two things follow, and both are
   * cheaper than the redesign that was first proposed:
   *
   *  - a screen pushed without the tab bar has ~56dp more to play with, and
   *  - the arch spends 52dp on top padding, drawn for portrait.
   *
   * Together those close it. Neither is free — the padding is what stops the
   * numeral sitting on the arch's shoulder — so this stays a design decision,
   * just a much smaller one than "lay the tally out sideways".
   */
  it('does NOT fit a phone in landscape, and by how much', () => {
    const short = budget(932, 430) - usable(430);
    expect(short).toBeGreaterThan(0);
    expect(short).toBeLessThan(120);
  });

  it('is short because of chrome, not because the stack is too tall', () => {
    // The stack alone clears a 430dp landscape phone. It is the tab bar and
    // the insets that push it under, which is why the fix is a trim rather
    // than a re-layout.
    expect(budget(932, 430)).toBeLessThan(430);

    // Trimming the arch's portrait top padding on a pushed screen — no tab
    // bar — is enough on its own.
    const trimmed = budget(932, 430) - (SPACE.xl + SPACE.lg);
    expect(trimmed).toBeLessThan(usable(430, { tabs: 0 }));
  });

  it('keeps the numeral itself inside its share of a landscape screen', () => {
    // The one part of this already fixed, and the fix holds: `theme/tally.ts`
    // bounds the numeral by viewport height, so it is 17% of a landscape phone
    // rather than the quarter it used to eat.
    expect(tallySize(932, 430) / 430).toBeLessThanOrEqual(TALLY.ofHeight + 0.01);
    expect(tallySize(1280, 800)).toBe(TALLY.max);
    expect(tallySize(640, 360)).toBe(TALLY.min);
  });
});
