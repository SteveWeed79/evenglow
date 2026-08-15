import { beforeEach, describe, expect, it } from 'vitest';
import { Text } from 'react-native';
import { newId } from '@steading/contracts';
import { LAYOUT } from '../../apps/mobile/src/theme/tokens';
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
    'steading.claims': JSON.stringify({ userId: 'u1', orgId: ORG, role: 'owner' }),
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
    expect(row?.children).toHaveLength(2);
    tablet.unmount();
  });

  it('gives the column its measure and the aside what is left', async () => {
    seedWindow(TABLET);
    const screen = await mount(frame());
    const [row] = rows(screen.tree.toJSON());

    // The pane's style is `[styles.pane, { width }]`, so it has to be merged
    // the way the layout engine would rather than read as one object.
    const widths = (row?.children ?? []).map((c) => flat((c as Node).props?.style).width);

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

interface Node {
  props?: Record<string, unknown>;
  children?: unknown;
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
