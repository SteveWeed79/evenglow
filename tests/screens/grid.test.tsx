import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { LAYOUT, SPACE } from '../../apps/mobile/src/theme/tokens';
import { columnsFor, hasRail, widthClass } from '../../apps/mobile/src/theme/window';
import { enqueue } from '@homefarm/core/sync/queue';
import { FarmScreen } from '../../apps/mobile/src/screens/FarmScreen';
import { GrowingScreen } from '../../apps/mobile/src/screens/GrowingScreen';
import { IronScreen } from '../../apps/mobile/src/screens/IronScreen';
import { StockScreen } from '../../apps/mobile/src/screens/StockScreen';
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

/** The same tablet stood up, which is where Stock and Iron are a grid. */
const PORTRAIT = { width: 800, height: 1280 };

beforeEach(async () => {
  await freshStore();
  seedWindow();
  seedInsets();
  seedSecureStore({
    'homefarm.claims': JSON.stringify({ userId: 'u1', orgId: ORG, role: 'owner' }),
  });
});

/**
 * The width `Screen` hands down: the safe window, less the rail, capped, less
 * its own padding.
 *
 * The rail is in here because **a hub is a tab screen**. Farm sits behind the
 * bar, so above the expanded boundary it sits beside a rail and has 96dp less
 * to divide than the window suggests. Modelled rather than hard-coded so this
 * helper fails loudly if the rail's width or the boundary moves — which is
 * exactly what happened when `LAYOUT.rail` grew from 80 to 96.
 */
function content(windowWidth: number, cap: number, insets = 0): number {
  const safe = windowWidth - insets;
  const usable = safe - (hasRail(widthClass(safe)) ? LAYOUT.rail : 0);
  return Math.min(usable, cap) - SPACE.lg * 2;
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

    const width = content(TABLET.width, LAYOUT.wide, 128);
    const expected = (width - SPACE.md) / 2;
    const widths = cellWidths(screen.tree.toJSON(), 'farm-grid');

    expect(widths.length).toBeGreaterThan(2);
    for (const w of widths) expect(w).toBeCloseTo(expected, 6);
    screen.unmount();
  });
});

/**
 * Every card fills the cell it was given.
 *
 * ## The ragged row, and why the cells were never the problem
 *
 * `alignItems` defaults to `stretch`, per flex line, so the sizing views
 * `<Grid>` wraps its children in already match the tallest cell in their row
 * without being asked. What does not is the card inside one: it is an ordinary
 * block child of a column, so it takes its content's height and leaves the
 * rest of the cell empty under its own border.
 *
 * A group carrying "Ready to process at 65–87 weeks" therefore stood 60dp
 * taller than the one beside it, and a Jobs row whose detail wrapped to two
 * lines stood taller than "Machines and kit". Reported off the tablet, on
 * Stock and on The farm, and true of every hub in the app at once.
 *
 * ## What this asserts, and what it cannot
 *
 * There is no layout engine here, so nothing below measures a frame — the same
 * bargain the rest of this file makes. What it can see is the property the
 * layout engine acts on: the card in each cell declares `flexGrow`. That is
 * enough to catch the regression that matters, which is a new hub card written
 * without it, because the four that exist today were all written without it.
 *
 * `flexGrow` and never `flex`, and the test says so: `flex: 1` also sets
 * `flexBasis: 0`, and below the two-column threshold `<Grid>` returns its
 * children bare into a column of their own height, where a zero basis is
 * measured as no height at all. That is every card on every phone collapsing,
 * so it is worth failing on rather than trusting to review.
 */
describe('the cards in a grid', () => {
  /** The style of the element inside each cell, flattened the way RN would. */
  function cards(node: unknown, testID: string): Record<string, unknown>[] {
    const grid = host(node, testID);
    if (grid === null) return [];

    const cells = (Array.isArray(grid.children) ? grid.children : []).filter(
      (c): c is Node => typeof c === 'object' && c !== null,
    );

    return cells.map((cell) => {
      const [child] = (Array.isArray(cell.children) ? cell.children : []).filter(
        (c): c is Node => typeof c === 'object' && c !== null,
      );
      // A `Touch` takes its style as a function of the pressed state; by the
      // time it reaches the tree it has been called. Flattened either way, the
      // same helper `tap-size.test.tsx` uses.
      const merged: Record<string, unknown> = {};
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) return void v.forEach(walk);
        if (typeof v === 'object' && v !== null) Object.assign(merged, v);
      };
      walk(child?.props?.style);
      return merged;
    });
  }

  /**
   * Each hub in the window where it actually draws a grid, which is not the
   * same window for all four.
   *
   * Stock and Iron carry a detail pane, so at 1280 they are **split** and their
   * cards are laid out inside a 600dp pane — one column, and `<Grid>` renders
   * nothing at all below two. The portrait tablet is where a farmer sees them
   * as a grid, and it is the window the ragged row was reported from. The farm
   * is the opposite: at 800dp its cells fall under the `Row` measure and it is
   * a single column, so it has to be asked in landscape.
   */
  const hubs: [string, string, () => React.ReactElement, typeof TABLET][] = [
    // Farm covers Settings and Log something too: all three are made of `Row`,
    // so they share one style and cannot disagree.
    ['The farm', 'farm-grid', FarmScreen, TABLET],
    ['Stock', 'stock-grid', StockScreen, PORTRAIT],
    ['Iron', 'iron-grid', IronScreen, PORTRAIT],
    ['Growing', 'growing-grid', GrowingScreen, PORTRAIT],
  ];

  beforeEach(async () => {
    /**
     * **Two of each, and one would have proved nothing.** `<Grid>` takes the
     * lesser of the columns that fit and the cells it has, so a hub holding a
     * single card is a single column and renders no grid at all — the test
     * then finds nothing to check and says so, which is how this seed started
     * out wrong.
     */
    for (const name of ['The hens', 'The goats']) {
      await enqueue({
        entity: 'flock',
        op: 'create',
        targetId: newId(),
        payload: { name, species: 'chicken', count: 6, purposes: ['eggs'] },
      });
    }
    for (const name of ['The tractor', 'The mower']) {
      await enqueue({
        entity: 'equipment',
        op: 'create',
        targetId: newId(),
        payload: { name, hasHourMeter: true },
      });
    }
    const site = newId();
    await enqueue({
      entity: 'site',
      op: 'create',
      // Frost dates and all: Growing asks "first, where are you?" and shows no
      // beds at all until the site is set up.
      targetId: site,
      payload: {
        name: 'The garden',
        frost: { lastSpring: 515, firstAutumn: 1005, source: 'entered' },
      },
    });
    for (const name of ['Bed three', 'Bed four']) {
      await enqueue({
        entity: 'bed',
        op: 'create',
        targetId: newId(),
        payload: { siteId: site, name, covered: false },
      });
    }
  });

  for (const [name, testID, Hub, window] of hubs) {
    it(`fills every cell on ${name}`, async () => {
      seedWindow(window);
      const screen = await mount(<Hub />);

      const found = cards(screen.tree.toJSON(), testID);

      // A hub with no cells would pass every assertion below by saying nothing.
      expect(found.length).toBeGreaterThan(0);
      for (const style of found) {
        expect(style['flexGrow'], name).toBe(1);
        // See the note above: a zero basis collapses the card on every phone.
        expect(style['flexBasis'], name).toBeUndefined();
      }
      screen.unmount();
    });
  }
});
