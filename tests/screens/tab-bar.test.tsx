import { describe, expect, it } from 'vitest';
import { TabDividers } from '../../apps/mobile/src/navigation/TabDividers';
import { mount, type Mounted } from '../support/screen';

/**
 * How many lines the bar actually draws.
 *
 * **This exists because the previous version drew one line where two were
 * asserted, and every test passed.** The offsets were computed correctly and
 * proved correct; the positioning was a percentage `left` on an absolutely
 * positioned child, which resolved against a box that was not the one it
 * appeared to be. Arithmetic that is right is not an implementation that
 * works, and a suite that only tests the arithmetic will say so cheerfully.
 *
 * Counting what renders is the half that can be checked here. Whether the
 * lines land where a person expects is still a handset question and this does
 * not pretend otherwise — but "one fewer line than tabs, every time" is now a
 * fact about the tree rather than about a helper nothing calls.
 */
describe('what the bar actually draws', () => {
  /**
   * The lines are the only nodes in this tree carrying the divider style, and
   * that style is the one with a `width` on it — the slots have `flex` and the
   * row has `flexDirection`.
   */
  const linesIn = (screen: Mounted): number =>
    screen.tree.root.findAll((node) => {
      // Host elements only. `findAll` walks composites too, so every View was
      // being counted twice — which would have made this test pass at one tab
      // and lie at two, in the same shape as the bug it exists for.
      if (typeof node.type !== 'string') return false;
      const style = node.props['style'] as unknown;
      const flat = Array.isArray(style) ? style : [style];
      return flat.some((s) => s !== null && typeof s === 'object' && 'width' in s && 'left' in s);
    }).length;

  it('draws one fewer line than there are tabs', async () => {
    for (const count of [1, 2, 3, 4, 5]) {
      const screen = await mount(<TabDividers count={count} />);
      expect(linesIn(screen), `${count} tabs`).toBe(count - 1);
      screen.unmount();
    }
  });

  /**
   * A bar of one tab is not a bar with a line down the middle of it, and a bar
   * of none is not a crash.
   */
  it('draws nothing when there is nothing to divide', async () => {
    for (const count of [0, 1]) {
      const screen = await mount(<TabDividers count={count} />);
      expect(linesIn(screen)).toBe(0);
      screen.unmount();
    }
  });
});
