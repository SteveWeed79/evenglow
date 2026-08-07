import { describe, expect, it } from 'vitest';
import {
  dividerLength,
  TAB_DIVIDER,
  TAB_MARKS as TABS,
} from '../../apps/mobile/src/navigation/tab-marks';

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
