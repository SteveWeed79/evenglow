import { describe, expect, it } from 'vitest';
import { ENTERPRISES, type Enterprise } from '@steading/contracts';
import { TAB_MARKS, tabs } from '../../apps/mobile/src/navigation/tab-marks';

/**
 * What a farm runs decides what it sees — and where that decision now lives.
 *
 * It used to hide whole tabs: a market gardener got no Stock tab, a suburban
 * poultry keeper got no Iron. That worked, and it had a cost nobody had named
 * — **the bar changed shape under somebody's thumb.** Switching Growing on
 * moved every other tab along, and muscle memory is most of what a tab bar is
 * for.
 *
 * The three places are one tab now (`FarmScreen`), so the same filtering hides
 * a row instead. The bar is three, for everybody, always.
 */

const names = (): string[] => tabs().map((tab) => tab.name);

describe('the bottom bar', () => {
  it('is the same three for every farm', () => {
    expect(names()).toEqual(['Today', 'Farm', 'History']);
  });

  /**
   * The property the old per-farm bar could not have. A tab that moves when a
   * setting changes is a tab somebody has to look for again.
   */
  it('does not change with what the farm runs', () => {
    const combinations: Enterprise[][] = [
      [],
      ['stock'],
      ['growing'],
      ['iron'],
      ['stock', 'iron'],
      [...ENTERPRISES],
    ];

    for (const _combination of combinations) {
      expect(names()).toEqual(['Today', 'Farm', 'History']);
    }
  });

  /**
   * An app with no tab bar is a dead end, and a farm that has switched
   * everything off must still be able to switch it back on — which is why
   * `FarmScreen` carries "What you run" under the places it lists.
   */
  it('keeps a way in whatever a farm has turned off', () => {
    expect(names()).toContain('Today');
    expect(names()).toContain('Farm');
  });

  it('never invents a tab that is not in the bar', () => {
    for (const tab of tabs()) {
      expect(TAB_MARKS.some((known) => known.name === tab.name)).toBe(true);
    }
  });
});
