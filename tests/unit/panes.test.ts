import { describe, expect, it } from 'vitest';
import { LAYOUT, SPACE } from '../../apps/mobile/src/theme/tokens';
import {
  asideWidth,
  cellWidth,
  columnsFor,
  heightClass,
  TWO_PANE_AT,
  widthClass,
  windowClass,
} from '../../apps/mobile/src/theme/window';
import { rotationFor } from '../../apps/mobile/src/theme/rotation';

/**
 * How much room the app thinks it has.
 *
 * The companion to `landscape-fold.test.ts`, which answers "does the commit
 * button fit above the fold" — this one answers "how many columns is that
 * button in". Same method and the same reason for it: the suite has no layout
 * engine, so it adds up the tokens the layout will be built from, which is the
 * same sum the layout engine will do.
 *
 * Every number here is asserted as a **sum of its parts** rather than as a
 * literal. A threshold written as `992` is a threshold nobody can argue with
 * later; written as `column + spacer + aside.min + 2 × margin` it moves when
 * its reasons move, and this file says so out loud when they do.
 */

/** Real windows, in dp, as the app will actually meet them. */
const WINDOWS = {
  'a small phone': [360, 640],
  'Pixel 7': [412, 915],
  'a large phone': [430, 932],
  '8" tablet, upright': [600, 1024],
  '8" tablet, turned': [1024, 600],
  '10" tablet, upright': [800, 1280],
  '10" tablet, turned': [1280, 800],
  'a 10" tablet split in half': [640, 800],
  'a desktop window': [1600, 1000],
} as const;

describe('width and height classes', () => {
  it('uses Android’s own boundaries', () => {
    // Not this app's numbers. A display the OS calls large is one this app
    // calls large, which is the entire value of not inventing a scale.
    expect(widthClass(599)).toBe('compact');
    expect(widthClass(600)).toBe('medium');
    expect(widthClass(839)).toBe('medium');
    expect(widthClass(840)).toBe('expanded');
    expect(widthClass(1199)).toBe('expanded');
    expect(widthClass(1200)).toBe('large');

    expect(heightClass(479)).toBe('compact');
    expect(heightClass(480)).toBe('medium');
    expect(heightClass(899)).toBe('medium');
    expect(heightClass(900)).toBe('expanded');
  });

  /**
   * The line the whole plan turns on.
   *
   * A 10" tablet is a *medium*-width, *expanded*-height window standing up and
   * a *large*-width, *medium*-height one lying down. The app had one
   * breakpoint at 600 and could describe neither — which is why it drew a
   * phone in the middle of a tablet.
   */
  it('tells a tablet’s two orientations apart', () => {
    const up = windowClass(...WINDOWS['10" tablet, upright']);
    expect([up.width, up.height]).toEqual(['medium', 'expanded']);

    const over = windowClass(...WINDOWS['10" tablet, turned']);
    expect([over.width, over.height]).toEqual(['large', 'medium']);
  });

  it('agrees with the rotation rule about what a phone is', () => {
    // Two rules, two sources — one reads the screen and one reads the window —
    // and they must not disagree about the compact boundary they share.
    for (const name of ['a small phone', 'Pixel 7', 'a large phone'] as const) {
      const [w, h] = WINDOWS[name];
      expect(widthClass(w), name).toBe('compact');
      expect(rotationFor(w, h), name).toBe('portrait_up');
    }
  });
});

describe('the two-pane threshold', () => {
  it('is the sum of the things that have to fit', () => {
    expect(TWO_PANE_AT).toBe(
      LAYOUT.column + LAYOUT.spacer + LAYOUT.aside.min + LAYOUT.margin * 2,
    );
    // And the sum comes out where the prose says it does. If this line and the
    // one above disagree, a token moved and the plan needs re-reading.
    expect(TWO_PANE_AT).toBe(992);
  });

  it('opens a pane only where one genuinely fits', () => {
    const rail = { chrome: LAYOUT.rail };
    const two = ['10" tablet, turned', 'a desktop window'] as const;
    const one = [
      'a small phone',
      'Pixel 7',
      'a large phone',
      '8" tablet, upright',
      '8" tablet, turned',
      '10" tablet, upright',
      'a 10" tablet split in half',
    ] as const;

    for (const name of two) {
      const [w, h] = WINDOWS[name];
      expect(windowClass(w, h, rail).panes, name).toBe(2);
    }
    for (const name of one) {
      const [w, h] = WINDOWS[name];
      expect(windowClass(w, h, rail).panes, name).toBe(1);
    }
  });

  /**
   * The one window whose answer the rail decides, written down because the
   * first draft of this file got it backwards and this test is what said so.
   *
   * An 8" tablet in landscape is 1024, which clears 992 on its own — so it is
   * a **two**-pane window until the rail exists and a one-pane window
   * afterwards. That is not a wobble to paper over: it is why `windowClass`
   * takes the chrome as an argument rather than assuming it.
   *
   * Landing it single is the outcome worth having. It is 600dp tall, which is
   * medium height and the tighter of its two classes, so a second pane there
   * would be cramped on both axes at once — and the shortfall is asserted
   * rather than the verdict alone, so anyone arguing to lower the threshold
   * has to answer the height as well.
   */
  it('turns on the rail for an 8" tablet, and by how little', () => {
    const [w, h] = WINDOWS['8" tablet, turned'];

    expect(windowClass(w, h).panes).toBe(2);
    expect(windowClass(w, h, { chrome: LAYOUT.rail }).panes).toBe(1);

    expect(TWO_PANE_AT - (w - LAYOUT.rail)).toBe(48);
    expect(heightClass(h)).toBe('medium');
  });

  /**
   * And the one it does not, which is the reassuring half.
   *
   * A 10" tablet in landscape clears the threshold with 208dp to spare, so the
   * arrangement the whole plan is drawn for does not depend on the rail
   * arriving or on anyone's arithmetic about it.
   */
  it('leaves a 10" tablet two-pane either way', () => {
    const [w, h] = WINDOWS['10" tablet, turned'];
    expect(windowClass(w, h).panes).toBe(2);
    expect(windowClass(w, h, { chrome: LAYOUT.rail }).panes).toBe(2);
    expect(w - LAYOUT.rail - TWO_PANE_AT).toBe(208);
  });

  /**
   * A cutout is width the app may not draw into, so it comes off first.
   *
   * `insets.left` and `insets.right` were read nowhere in the app before this
   * — complete in portrait, and wrong the moment a landscape tablet has a
   * cutout on an edge. A window one dp over the line with a 48dp cutout is
   * under it, and must be told so.
   */
  it('takes the horizontal insets off before deciding anything', () => {
    const bare = windowClass(TWO_PANE_AT, 800);
    expect(bare.panes).toBe(2);
    expect(bare.usable).toBe(TWO_PANE_AT);

    const cut = windowClass(TWO_PANE_AT, 800, { insets: { left: 48, right: 0 } });
    expect(cut.usable).toBe(TWO_PANE_AT - 48);
    expect(cut.panes).toBe(1);
  });

  /**
   * A cutout narrows the window; chrome only narrows the content.
   *
   * The distinction is the reason they are separate arguments. A large display
   * is large whatever the app chooses to stand in it, so the rail must not be
   * able to talk a window down a class — only to take room off what is left
   * for content.
   */
  it('lets chrome take content width without changing the window’s class', () => {
    const w = windowClass(1280, 800, { chrome: LAYOUT.rail });
    expect(w.width).toBe('large');
    expect(w.usable).toBe(1280 - LAYOUT.rail);

    const cut = windowClass(1280, 800, { insets: { left: 100, right: 0 } });
    expect(cut.width).toBe('expanded');
  });
});

describe('the aside', () => {
  it('takes what is spare, between its floor and its ceiling', () => {
    // Exactly at the threshold it is the floor and not a dp less — which is
    // what makes the threshold honest rather than a place the layout breaks.
    expect(asideWidth(TWO_PANE_AT)).toBe(LAYOUT.aside.min);

    // A 10" tablet in landscape: the ceiling binds and the surplus becomes
    // margin, so the assembly centres rather than the sidebar sprawling.
    expect(asideWidth(1280)).toBe(LAYOUT.aside.max);
    expect(asideWidth(1600)).toBe(LAYOUT.aside.max);
  });

  it('never lets the pair exceed the width it was given', () => {
    for (const usable of [992, 1024, 1100, 1280, 1440, 1600]) {
      const total = LAYOUT.column + LAYOUT.spacer + asideWidth(usable) + LAYOUT.margin * 2;
      expect(total, `${usable}dp`).toBeLessThanOrEqual(Math.max(usable, TWO_PANE_AT));
    }
  });

  it('is the same 1104 the hub grids and the charts use', () => {
    // Sharing the number is the point: a hub and a two-pane screen laid out to
    // different widths would shift relative to each other on every navigation.
    expect(LAYOUT.column + LAYOUT.spacer + LAYOUT.aside.max).toBe(LAYOUT.wide);
    expect(LAYOUT.wide).toBe(1104);
  });
});

describe('the grid', () => {
  it('gives a phone one column and never more', () => {
    for (const name of ['a small phone', 'Pixel 7', 'a large phone'] as const) {
      expect(columnsFor(WINDOWS[name][0]), name).toBe(1);
    }
  });

  it('gives two at the width a hub is allowed to reach, and stops there', () => {
    // Two, and it keeps saying two however large the display gets, because the
    // hub is capped at LAYOUT.wide. Three columns of hub rows is a directory.
    expect(columnsFor(LAYOUT.wide)).toBe(2);
    expect(columnsFor(2000)).toBeGreaterThan(2);
  });

  /**
   * The off-by-one this function exists to not have.
   *
   * n columns have n−1 gaps between them. A version that divided by the cell
   * alone reported two columns fitting in exactly `2 × cell` and then
   * overflowed its container by one gap — invisible in Node, and a row of
   * clipped text on a handset.
   */
  it('counts the gaps between the cells, not after them', () => {
    expect(columnsFor(LAYOUT.cell * 2 - 1)).toBe(1);
    expect(columnsFor(LAYOUT.cell * 2 + SPACE.md)).toBe(2);
  });

  it('divides the width exactly, gaps included', () => {
    for (const width of [LAYOUT.wide, 800, 1200]) {
      const columns = columnsFor(width);
      const cells = cellWidth(width, columns) * columns + SPACE.md * (columns - 1);
      expect(cells, `${width}dp`).toBeCloseTo(width, 6);
    }
  });

  it('never returns a cell narrower than the minimum it was given', () => {
    for (const width of [320, 400, 700, 1104, 1600]) {
      const columns = columnsFor(width);
      // One column may be narrower than a cell — a 320dp phone has no choice —
      // but two never may, or the drop to one column did not happen.
      if (columns > 1) expect(cellWidth(width, columns), `${width}dp`).toBeGreaterThanOrEqual(LAYOUT.cell);
    }
  });
});
