import { beforeEach, describe, expect, it } from 'vitest';
import { Text } from 'react-native';
import { newId } from '@homefarm/contracts';
import { LAYOUT, SPACE } from '../../apps/mobile/src/theme/tokens';
import { Screen } from '../../apps/mobile/src/components/Screen';
import { Tally } from '../../apps/mobile/src/components/Tally';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { seedWindow } from '../support/native/react-native';
import { seedInsets, seedSecureStore } from '../support/native/modules';

/**
 * The supporting pane, and the two things it must never do.
 *
 * It must never **drop** anything by being narrow (invariant 13), and it must
 * never **reorder** anything by being wide. Both are easy to get wrong in a way
 * no existing test would catch: the aside is a separate prop, so a screen that
 * silently rendered it only above the threshold would look correct on the
 * device it was built on and lose a whole column of content on every handset.
 */

const ORG = newId();

/** A 10" tablet in landscape. Two panes with 208dp to spare. */
const TABLET = { width: 1280, height: 800 };

beforeEach(async () => {
  await freshStore();
  seedWindow();
  seedInsets();
  seedSecureStore({
    'homefarm.claims': JSON.stringify({ userId: 'u1', orgId: ORG, role: 'owner' }),
  });
});

function frame(): React.ReactElement {
  return (
    <Screen title="Today" above={<Text>a warning</Text>} aside={<Text>the dues</Text>}>
      <Text>the tally</Text>
    </Screen>
  );
}

describe('a screen with an aside', () => {
  it('says everything on a phone, in the order it is written', async () => {
    const screen = await mount(frame());

    const said = screen.text();
    expect(said).toContain('a warning');
    expect(said).toContain('the tally');
    // The half that matters: restacked under the column, never dropped.
    expect(said).toContain('the dues');

    // Hero, above, children, aside — the fixed order `Screen` documents,
    // because on a phone that order IS the screen.
    expect(said.indexOf('a warning')).toBeLessThan(said.indexOf('the tally'));
    expect(said.indexOf('the tally')).toBeLessThan(said.indexOf('the dues'));
    screen.unmount();
  });

  it('says exactly the same things on a tablet', async () => {
    seedWindow(TABLET);
    const screen = await mount(frame());

    const said = screen.text();
    for (const words of ['a warning', 'the tally', 'the dues']) {
      expect(said, words).toContain(words);
    }
    screen.unmount();
  });

  /**
   * The pane row appears only where it fits, and `above` never joins it.
   *
   * A banner that got swept into one of the two columns is the failure
   * `TodayScreen` spends a paragraph guarding against — a safety strip in a
   * side column is a strip nobody reads — so the row must contain exactly the
   * two panes and nothing else.
   */
  it('lays out two panes on a tablet and none on a phone', async () => {
    const phone = await mount(frame());
    expect(rows(phone.tree.toJSON())).toHaveLength(0);
    phone.unmount();

    seedWindow(TABLET);
    const tablet = await mount(frame());
    const [row] = rows(tablet.tree.toJSON());

    expect(row).toBeDefined();
    expect(kids(row)).toHaveLength(2);
    tablet.unmount();
  });

  it('gives the column its measure and the aside what is left', async () => {
    seedWindow(TABLET);
    const screen = await mount(frame());
    const [row] = rows(screen.tree.toJSON());

    // The pane's style is `[styles.pane, { width }]`, so it has to be merged
    // the way the layout engine would rather than read as one object.
    const widths = kids(row).map((c) => flat(c.props?.style).width);

    // The column is never anything but the measure, however much room there
    // is. Everything else the window offers goes to the aside or the margins.
    expect(widths[0]).toBe(LAYOUT.column);
    expect(widths[1]).toBe(LAYOUT.aside.max);
    screen.unmount();
  });

  it('keeps one column when there is nothing to put in the second', async () => {
    seedWindow(TABLET);
    const screen = await mount(
      <Screen title="Today">
        <Text>the tally</Text>
      </Screen>,
    );

    // Room is not a reason to invent a pane. A screen with no aside keeps the
    // centred column it always had.
    expect(rows(screen.tree.toJSON())).toHaveLength(0);
    screen.unmount();
  });
});

/**
 * The step order is muscle memory, so it is not allowed to be a function of
 * the window.
 *
 * ## Why this test exists when nothing was changed
 *
 * The reach study proposed pulling the step row toward the pane's outer edge,
 * and reading the component said the work was already done: `styles.steps` is
 * a centred row of `TAP.min` targets, which is a 260dp group and not a row
 * spanning the pane. The mockups had drawn it stretched. Nothing to fix.
 *
 * What the study was *right* about is the trap, and the trap is still open:
 * the tempting way to put a stepper under a thumb is to reverse the order in
 * the mirrored layout. The Tally is reused for every countable log precisely
 * so the muscle memory transfers, and an order that flips with the window is
 * not muscle memory. So the finding is kept as a guard rather than as a change.
 */
describe('the tally steps', () => {
  it('are in the same order at every width', async () => {
    const order = async (): Promise<string[]> => {
      const screen = await mount(
        <Screen title="Eggs">
          <Tally label="Eggs" unit="eggs" steps={[1, 6, 12]} onCommit={() => undefined} />
        </Screen>,
      );
      // Deduped: a Step says its label both as its accessible name and as the
      // text on it, so the raw list repeats each one. First occurrence keeps
      // the order, which is the whole thing being asserted.
      const labels = [...new Set(screen.labels().filter((l) => /^\+\d+$|^−$/.test(l)))];
      screen.unmount();
      return labels;
    };

    const phone = await order();
    expect(phone).toEqual(['+1', '+6', '+12', '−']);

    seedWindow(TABLET);
    expect(await order()).toEqual(phone);
  });
});

/**
 * The bottom inset, and the thing that stopped reserving it.
 *
 * `Screen` read `back ? insets.bottom : 0` on the reasoning that a tab screen
 * has the bar beneath it and the bar reserves its own inset. True until the
 * bar became a rail — then nothing at all stood at the bottom of a tab screen
 * and the content ran under the system navigation. Reported off the tablet in
 * the first screenshot of the rail, which is the third time in this project a
 * missing inset has been found by looking rather than by testing.
 */
describe('the bottom inset once the bar is a rail', () => {
  const BOTTOM = 16;

  const paddings = (screen: { tree: { toJSON: () => unknown } }): number[] =>
    styles(screen.tree.toJSON())
      .map((s) => s.paddingBottom)
      .filter((v): v is number => typeof v === 'number');

  it('is reserved on a tab screen at rail width', async () => {
    seedWindow(TABLET);
    const screen = await mount(
      <Screen title="Today">
        <Text>the tally</Text>
      </Screen>,
    );

    // Nothing is standing there, so the content has to leave the room itself.
    expect(paddings(screen)).toContain(SPACE.xl + BOTTOM);
    screen.unmount();
  });

  it('is left to the bar on a phone, where the bar is still at the bottom', async () => {
    const screen = await mount(
      <Screen title="Today">
        <Text>the tally</Text>
      </Screen>,
    );

    // Adding it here too would be a second helping of the same gap, and Today
    // would end in a band of nothing.
    expect(paddings(screen)).toContain(SPACE.xl);
    expect(paddings(screen)).not.toContain(SPACE.xl + BOTTOM);
    screen.unmount();
  });

  it('is reserved on a pushed screen at every width', async () => {
    for (const window of [undefined, TABLET]) {
      seedWindow(window);
      const screen = await mount(
        <Screen title="Weigh" back>
          <Text>a form</Text>
        </Screen>,
      );
      expect(paddings(screen), String(window?.width ?? 'phone')).toContain(SPACE.xl + BOTTOM);
      screen.unmount();
    }
  });
});

/** Every element's effective style, flattened — same helper as reading-column. */
function styles(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    node.forEach((n) => styles(n, out));
    return out;
  }
  if (typeof node !== 'object' || node === null) return out;

  const n = node as { props?: { style?: unknown }; children?: unknown };
  if (n.props?.style !== undefined) {
    const merged: Record<string, unknown> = {};
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return void v.forEach(walk);
      if (typeof v === 'object' && v !== null) Object.assign(merged, v);
    };
    walk(n.props.style);
    out.push(merged);
  }
  if (n.children !== undefined) styles(n.children, out);
  return out;
}

interface Node {
  props?: Record<string, unknown>;
  children?: unknown;
}

/** A node's host children, typed. `children` off `toJSON()` is `unknown`. */
function kids(node: Node | undefined): Node[] {
  const children = node?.children;
  if (!Array.isArray(children)) return [];
  return children.filter((c): c is Node => typeof c === 'object' && c !== null);
}

/** One element's effective style, arrays flattened. */
function flat(style: unknown): { width?: number; flexDirection?: string; gap?: number } {
  const merged: Record<string, unknown> = {};
  const walk = (s: unknown): void => {
    if (Array.isArray(s)) return void s.forEach(walk);
    if (typeof s === 'object' && s !== null) Object.assign(merged, s);
  };
  walk(style);
  return merged;
}

/** Every pane row in the tree — a flex row gapped at `LAYOUT.spacer`. */
function rows(node: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    node.forEach((n) => rows(n, out));
    return out;
  }
  if (typeof node !== 'object' || node === null) return out;

  const n = node as Node;
  const style = flat(n.props?.style);
  if (style.flexDirection === 'row' && style.gap === LAYOUT.spacer) out.push(n);

  if (n.children !== undefined) rows(n.children, out);
  return out;
}

/**
 * The two panes scroll separately, and one scroll surface is what they used to
 * share.
 *
 * Dragging the tractor's history dragged the tractor list up with it and off
 * the top — the list, its actions and the heading gone, leaving a blank left
 * half beside a column of dates. Reported off the tablet with the screenshot to
 * match, and it is the ordinary case rather than an edge: a machine's timeline
 * is as long as the machine is old, and the column beside it is a dozen rows.
 *
 * The panes exist side by side *because they are read independently*. Tying
 * them to one scroll makes the shorter one a passenger.
 */
describe('what scrolls', () => {
  /** Every scroll surface in the tree, by whether it will actually scroll. */
  function scrolls(node: unknown, out: { enabled: boolean }[] = []): { enabled: boolean }[] {
    if (Array.isArray(node)) {
      for (const child of node) scrolls(child, out);
      return out;
    }
    if (node === null || typeof node !== 'object') return out;

    const n = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown };
    // RN renders a ScrollView as a host view carrying its props; the reliable
    // marker across versions is the prop it is configured with rather than the
    // element name, which the mock may rewrite.
    if (n.props !== undefined && 'scrollEventThrottle' in n.props) {
      out.push({ enabled: n.props.scrollEnabled !== false });
    } else if (n.props !== undefined && 'keyboardShouldPersistTaps' in n.props) {
      out.push({ enabled: n.props.scrollEnabled !== false });
    }

    if (n.children !== undefined) scrolls(n.children, out);
    return out;
  }

  it('gives a split screen a scroll per pane, and stills the one under them', async () => {
    seedWindow(TABLET);
    const screen = await mount(frame());

    const found = scrolls(screen.tree.toJSON());

    /**
     * Three surfaces: the outer one, which is now still, and one for each pane.
     * The outer is disabled rather than removed so the non-split path — every
     * form, every phone — renders exactly the tree it always did.
     */
    expect(found.filter((s) => s.enabled)).toHaveLength(2);
    expect(found.filter((s) => !s.enabled)).toHaveLength(1);
    screen.unmount();
  });

  /** A phone has one column, so it keeps one scroll and nothing changes. */
  it('leaves a phone with a single scrolling surface', async () => {
    seedWindow({ width: 400, height: 900 });
    const screen = await mount(frame());

    const found = scrolls(screen.tree.toJSON());

    expect(found.filter((s) => s.enabled)).toHaveLength(1);
    expect(found.filter((s) => !s.enabled)).toEqual([]);
    screen.unmount();
  });
});
