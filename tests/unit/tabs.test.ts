import { describe, expect, it } from 'vitest';
import { TAB_MARKS as TABS } from '../../apps/mobile/src/navigation/tab-marks';

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
 * and the answer is a different structure — not a smaller font. UX-SPEC §4
 * says a fifth tab means a rethink; this is where that argument gets had.
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

  it('gives every tab its own name and its own mark', () => {
    // Two tabs sharing an icon is a bar you navigate by position, which is the
    // one thing a bar of icons must not be.
    expect(new Set(TABS.map((t) => t.name)).size).toBe(TABS.length);
    expect(new Set(TABS.map((t) => t.icon)).size).toBe(TABS.length);
  });

  it('uses no name that needs a space to read', () => {
    // A space is where a label wraps first, and the slot has room for one word.
    for (const tab of TABS) expect(tab.name, tab.name).not.toContain(' ');
  });
});
