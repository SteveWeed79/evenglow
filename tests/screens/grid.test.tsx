import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { LAYOUT, SPACE } from '../../apps/mobile/src/theme/tokens';
import { columnsFor } from '../../apps/mobile/src/theme/window';
import { FarmScreen } from '../../apps/mobile/src/screens/FarmScreen';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { seedWindow } from '../support/native/react-native';
import { seedInsets, seedSecureStore } from '../support/native/modules';

/**
 * The hub, in as many columns as the room allows.
 *
 * The cheapest thing in `docs/LANDSCAPE-PLAN.md` and the one with the most
 * visible effect: eight rows in a 600dp column with 600dp of nothing beside
 * them, on a screen whose entire content is a list of equivalent doors.
 *
 * ## What this can and cannot prove
 *
 * There is no layout engine here, so nothing below measures a rendered frame.
 * What it does check is the two things that would actually go wrong: that the
 * grid **appears** at a tablet width and **does not** at a phone width, and
 * that the cell arithmetic handed to the children is the arithmetic
 * `theme/window.ts` was tested on. The rest is the same bargain the whole
 * screen suite makes — see `tests/support/native/react-native.tsx`.
 *
 * ## Why the phone case is the important half
 *
 * Invariant 13: nothing may be lost by being narrow. A grid that quietly
 * changed the box model of every hub on every handset would be a far worse
 * regression than a tablet that failed to use its width, and it is the one
 * that would ship unnoticed — the tablet is looked at deliberately and the
 * phone is looked at by everybody.
 */

const ORG = newId();

/** A 10" tablet in landscape, which is the window the whole plan is drawn for. */
const TABLET = { width: 1280, height: 800 };

beforeEach(async () => {
  await freshStore();
  seedWindow();
  seedInsets();
  seedSecureStore({
    'steading.claims': JSON.stringify({ userId: 'u1', orgId: ORG, role: 'owner' }),
  });
});

/** The width `Screen` hands down: the capped column, less its own padding. */
function content(windowWidth: number, cap: number): number {
  return Math.min(windowWidth, cap) - SPACE.lg * 2;
}

interface Node {
  props?: Record<string, unknown>;
  children?: unknown;
}

/**
 * The rendered host element with this testID, or null.
 *
 * `mounted.has()` cannot answer this question: it searches the *element* tree
 * with `findAllByProps`, which matches the composite `<Grid testID=…>` itself
 * whether or not that component rendered anything carrying the prop. Below the
 * threshold `Grid` returns a bare fragment, so `has('farm-grid')` is true and
 * the grid is not there — the exact false pass this helper exists to avoid.
 * `toJSON()` is the host tree, which is what actually reached the screen.
 */
function host(node: unknown, testID: string): Node | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = host(child, testID);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof node !== 'object' || node === null) return null;

  const n = node as Node;
  if (n.props?.testID === testID) return n;
  return n.children === undefined ? null : host(n.children, testID);
}

/** The laid-out cells of a grid: its host children and their widths. */
function cellWidths(node: unknown, testID: string): number[] {
  const grid = host(node, testID);
  if (grid === null) return [];
  const children = Array.isArray(grid.children) ? grid.children : [];
  return children
    .filter((c): c is Node => typeof c === 'object' && c !== null)
    .map((c) => (c.props?.style as { width?: number } | undefined)?.width ?? NaN);
}

describe('a hub on a phone', () => {
  it('renders no grid at all, and the rows straight into the column', async () => {
    const screen = await mount(<FarmScreen />);

    /**
     * Absent rather than present-with-one-column, and the distinction is the
     * whole reason `Grid` returns its children bare below the threshold.
     *
     * A single-column `flexWrap` row with a computed child width is a
     * different box model from a plain stack: it stops children growing to
     * their content and it double-counts `Screen`'s own gap. "One column"
     * has to mean *what shipped*, not "a grid that happens to be one wide".
     */
    expect(host(screen.tree.toJSON(), 'farm-grid')).toBeNull();

    // And the hub still works, which is the point of the invariant.
    expect(screen.has('farm-jobs')).toBe(true);
    expect(screen.has('farm-shelf')).toBe(true);
    expect(screen.has('farm-my-farm')).toBe(true);
    screen.unmount();
  });

  it('is the case the rest of the suite is already asserting', () => {
    // 390dp window → 350dp of content → one column. Every other screen test
    // in this repo runs at that width, so they are all standing guard over the
    // narrow case without having to say so.
    expect(columnsFor(content(390, LAYOUT.column))).toBe(1);
  });
});

describe('a hub on a tablet in landscape', () => {
  it('lays the rows out in two columns', async () => {
    seedWindow(TABLET);
    const screen = await mount(<FarmScreen />);

    expect(host(screen.tree.toJSON(), 'farm-grid')).not.toBeNull();

    /**
     * Two, and every cell the same width.
     *
     * The width is asserted against `cellWidth`'s own arithmetic rather than
     * against a literal, so a change to the gap or the cap moves both together
     * — and `tests/unit/panes.test.ts` is what holds that arithmetic honest.
     */
    const width = content(TABLET.width, LAYOUT.wide);
    const expected = (width - SPACE.md) / 2;
    const widths = cellWidths(screen.tree.toJSON(), 'farm-grid');

    expect(columnsFor(width)).toBe(2);
    expect(widths.length).toBeGreaterThan(2);
    for (const w of widths) expect(w).toBeCloseTo(expected, 6);
    screen.unmount();
  });

  it('offers exactly the same doors it does on a phone', async () => {
    // Invariant 13, as a test. A layout may rearrange what is on a screen; it
    // may never add or remove one, and a grid that dropped a conditional row
    // would do exactly that without any test noticing.
    const phone = await mount(<FarmScreen />);
    const narrow = phone.labels().join('|');
    phone.unmount();

    seedWindow(TABLET);
    const tablet = await mount(<FarmScreen />);
    expect(tablet.labels().join('|')).toBe(narrow);
    tablet.unmount();
  });

  /**
   * A cutout comes off before the columns are counted.
   *
   * Not a hypothetical: `windowClass` subtracts the horizontal insets, so a
   * window near a column boundary with a cutout on one edge must round down.
   * This is the case where forgetting them would show as a clipped cell rather
   * than as empty space, which is why it is worth a test of its own.
   */
  it('counts the columns from the safe area, not the window', async () => {
    seedWindow(TABLET);
    seedInsets({ left: 64, right: 64 });
    const screen = await mount(<FarmScreen />);

    const width = content(TABLET.width - 128, LAYOUT.wide);
    const expected = (width - SPACE.md) / 2;
    const widths = cellWidths(screen.tree.toJSON(), 'farm-grid');

    expect(widths.length).toBeGreaterThan(2);
    for (const w of widths) expect(w).toBeCloseTo(expected, 6);
    screen.unmount();
  });
});
