import { describe, expect, it } from 'vitest';
import { ENTERPRISES, type Enterprise } from '@steading/contracts';
import { TAB_MARKS, tabsFor } from '../../apps/mobile/src/navigation/tab-marks';

/**
 * What a farm runs decides what it sees.
 *
 * A market gardener has no stock. A poultry keeper on a suburban plot has no
 * tractor and no beds. Both used to get four tabs, two of them empty forever.
 */

const names = (enterprises: readonly Enterprise[]): string[] =>
  tabsFor(enterprises).map((tab) => tab.name);

describe('the tabs a farm sees', () => {
  it('shows all four when a farm runs everything', () => {
    expect(names(ENTERPRISES)).toEqual(['Today', 'Stock', 'Growing', 'Iron']);
  });

  it('drops Growing and Iron for somebody who only keeps animals', () => {
    expect(names(['stock'])).toEqual(['Today', 'Stock']);
  });

  it('drops Stock and Iron for a market gardener', () => {
    expect(names(['growing'])).toEqual(['Today', 'Growing']);
  });

  it('keeps Today whatever happens, including nothing at all', () => {
    /**
     * An app with no tab bar is a dead end. Today is where the answer to an
     * empty farm lives — it is the screen that says there is nothing to log
     * yet — so it survives every combination.
     */
    expect(names([])).toEqual(['Today']);
  });

  it('never invents a tab that is not in the bar', () => {
    for (const subset of [[], ['stock'], ['growing'], ['iron'], [...ENTERPRISES]] as Enterprise[][]) {
      for (const tab of tabsFor(subset)) {
        expect(TAB_MARKS.some((known) => known.name === tab.name)).toBe(true);
      }
    }
  });

  it('gives every enterprise somewhere to be seen', () => {
    // An enterprise a farm can switch on that shows them nothing would be a
    // setting with no effect.
    for (const enterprise of ENTERPRISES) {
      expect(TAB_MARKS.some((tab) => tab.enterprise === enterprise), enterprise).toBe(true);
    }
  });

  it('holds the bar within the width it can draw, whatever is on', () => {
    // The same budget tabs.test.ts asserts, checked against every combination
    // a farm can actually produce rather than only the default four.
    for (const subset of [[], ['stock'], ['stock', 'growing'], [...ENTERPRISES]] as Enterprise[][]) {
      expect(tabsFor(subset).length).toBeLessThanOrEqual(5);
    }
  });
});
