import { describe, expect, it } from 'vitest';
import {
  dividerLength,
  dividerOffsets,
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

/**
 * The hairlines between the tabs.
 *
 * Geometry only — whether they *look* right is a handset question and this
 * cannot answer it. What it can hold is the three ways the arithmetic goes
 * wrong silently: a line on the outer edge, a line that misses a boundary, and
 * a bar that gains a tab without gaining a divider.
 */
describe('the lines between them', () => {
  it('draws one fewer line than there are tabs', () => {
    expect(dividerOffsets(TABS.length)).toHaveLength(TABS.length - 1);

    // Including the shapes the bar is allowed to take, not just today's.
    for (let count = 1; count <= MOST_TABS; count += 1) {
      expect(dividerOffsets(count), `${count} tabs`).toHaveLength(count - 1);
    }
  });

  /**
   * A line at 0 or 1 would sit on the screen edge, double the bar's own
   * border on one side and read as a frame around the bar rather than a
   * division inside it.
   */
  it('never puts one on an outer edge', () => {
    for (let count = 2; count <= MOST_TABS; count += 1) {
      for (const offset of dividerOffsets(count)) {
        expect(offset).toBeGreaterThan(0);
        expect(offset).toBeLessThan(1);
      }
    }
  });

  it('puts each one exactly on a boundary between slots', () => {
    // Evenly spaced, because the bar divides its width evenly. A line half a
    // slot out is worse than no line — it groups the wrong pair.
    const three = dividerOffsets(3);
    expect(three[0]).toBeCloseTo(1 / 3, 10);
    expect(three[1]).toBeCloseTo(2 / 3, 10);
  });

  it('is one tab bar, not a segmented control', () => {
    /**
     * The line has to be visibly shorter than the bar or it reads as a table
     * cell — a different promise about what pressing does. Roughly the height
     * of a mark and its label is what brackets the content instead of ruling
     * the whole bar.
     */
    expect(dividerLength()).toBeGreaterThan(0.3);
    expect(dividerLength()).toBeLessThan(0.6);
    // Centred: equal clearance top and bottom falls out of using one inset.
    expect(TAB_DIVIDER.inset * 2 + dividerLength()).toBeCloseTo(1, 10);
  });
});
