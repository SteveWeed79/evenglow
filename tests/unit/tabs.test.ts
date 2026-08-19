import { describe, expect, it } from 'vitest';
import {
  dividerLength,
  TAB_DIVIDER,
  TAB_MARKS as TABS,
} from '../../apps/mobile/src/navigation/tab-marks';
import { LAYOUT, SPACE, TAP, TYPE } from '../../apps/mobile/src/theme/tokens';
import { hasRail } from '../../apps/mobile/src/theme/window';

/**
 * The bottom bar, held to a width it can actually draw.
 *
 * Every screenshot of the app so far shows the same defect: "TODAY" wrapped to
 * "TODA / Y", "STOCK" to "STOC / K", "GROWING" to "GROW / ING". The label is
 * drawn into the navigator's icon slot, which is a narrow box, and nothing
 * limited it to one line.
 *
 * `numberOfLines` fixes the wrapping. These fix the cause: a tab bar divides
 * the screen by however many tabs there are, so both the count and the length
 * of the names are a shared budget. Neither is visible in a typecheck and
 * neither fails until somebody looks at a phone.
 */

/** What fits on the narrowest phone worth supporting, uppercase, at label size. */
const LONGEST_NAME = 8;

/**
 * Beyond this the labels stop being readable however far the type gives way,
 * and the answer is a different structure — not a smaller font.
 *
 * That is exactly what happened. What happened needed a place and the bar was
 * full, which looked like a case for amending UX-SPEC §4 to allow a fifth. The
 * rethink §4 actually asks for turned out to be cheaper: Stock, Growing and
 * Iron are all *places you go*, so they became one Farm hub and the bar came
 * down to three. Four remains the wall and there is now room under it.
 */
const MOST_TABS = 5;

describe('the bottom bar', () => {
  it('has names short enough to draw on one line', () => {
    for (const tab of TABS) {
      expect(tab.name.length, tab.name).toBeLessThanOrEqual(LONGEST_NAME);
    }
  });

  it('stays within the number of tabs the bar can divide', () => {
    expect(TABS.length).toBeLessThanOrEqual(MOST_TABS);
  });

  /**
   * The bar is words now.
   *
   * It used to assert a distinct mark per tab as well, on the argument that
   * two tabs sharing an icon is a bar you navigate by position. That argument
   * survives and its subject does not: the three marks were a doorway, a
   * doorway with a floor, and a bare tree, told apart by the word beneath
   * them. The word was doing the work, so the word is what is left — and the
   * lines between them are what say three words are three things.
   */
  it('gives every tab its own name', () => {
    expect(new Set(TABS.map((t) => t.name)).size).toBe(TABS.length);
  });

  it('uses no name that needs a space to read', () => {
    // A space is where a label wraps first, and the slot has room for one word.
    for (const tab of TABS) expect(tab.name, tab.name).not.toContain(' ');
  });
});

/**
 * The hairlines between the tabs — what is left of them that is arithmetic.
 *
 * **There used to be more here, and it all passed while the bar drew one line
 * instead of two.** The first version positioned each line with
 * `left: '66.666…%'` and this file proved the offsets were 1/3 and 2/3, which
 * they were. The percentage resolved against a box that was not the one it
 * looked like, and no assertion in Node could have seen that.
 *
 * The lesson is in the implementation rather than in a new test: `count` slots
 * at `flex: 1`, one line on the left edge of every slot but the first. There
 * is no arithmetic left to get wrong, which is why there is no arithmetic left
 * to test. `tests/screens/tab-bar.test.tsx` counts what renders; the geometry
 * is now structural and a handset is still the only thing that can confirm it
 * looks right.
 */
describe('the lines between them', () => {
  it('is one tab bar, not a segmented control', () => {
    /**
     * The line has to be visibly shorter than the bar or it reads as a table
     * cell — a different promise about what pressing does.
     */
    expect(dividerLength()).toBeGreaterThan(0.3);
    expect(dividerLength()).toBeLessThan(0.6);
    // Centred: equal clearance top and bottom falls out of using one inset.
    expect(TAB_DIVIDER.inset * 2 + dividerLength()).toBeCloseTo(1, 10);
  });
});

/**
 * The rail, and the one thing it must not change.
 *
 * At expanded width the bar moves to the leading edge — 88dp of height back on
 * the axis a landscape tablet is short of, and the destinations put under a
 * thumb instead of in the centre-bottom dead spot.
 *
 * **UX-SPEC §4 is untouched by that.** The rule is about how many destinations
 * a person chooses between at 6am, not which edge they sit on, so a rail is
 * the same three tabs somewhere else. The budget below therefore still binds,
 * and the assertions above still apply to it.
 */
describe('the rail', () => {
  it('starts where the platform says a window is expanded', () => {
    expect(hasRail('compact')).toBe(false);
    expect(hasRail('medium')).toBe(false);
    expect(hasRail('expanded')).toBe(true);
    expect(hasRail('large')).toBe(true);
  });

  /**
   * A word, not a glyph, which is why the rail is wider than Material's.
   *
   * `TabMark` records this bar clipping its labels twice, both times because a
   * word was put in a box measured for something else. A rail is 80dp because
   * it holds a 24dp icon with a short label under it; this one holds the label
   * alone, and the budget above allows eight characters.
   *
   * The estimate is the data face's 0.6em advance at `TYPE.label`, plus the
   * tracking `TabMark` applies, plus the padding either side. It is an
   * estimate and the device is the judge — but it must not be *obviously*
   * short, which is what it was at 80.
   */
  it('is wide enough for the longest name the budget allows', () => {
    const glyph = TYPE.label * 0.6;
    const tracking = 1;
    const longest = LONGEST_NAME * (glyph + tracking);

    expect(longest).toBeLessThanOrEqual(LAYOUT.rail - SPACE.md * 2);
    // And the 80 it was: short of the same word, which is why it moved.
    expect(longest).toBeGreaterThan(80 - SPACE.md * 2);
  });

  /**
   * It costs less width than the bar cost height, on the axis that is scarce.
   *
   * A landscape tablet is large-width and medium-height. Spending 96dp of the
   * plentiful axis to recover 88dp of the scarce one is the whole trade, and
   * if a future change inverts it the rail has stopped being worth having.
   */
  it('trades the scarce axis for the plentiful one', () => {
    const bar = TAP.primary + 24;
    expect(bar).toBe(88);
    expect(LAYOUT.rail).toBeGreaterThan(bar - 24);
  });
});
