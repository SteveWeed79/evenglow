import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { MachineScreen } from '../../apps/mobile/src/screens/MachineScreen';
import { SPACE, TAP } from '../../apps/mobile/src/theme/tokens';

/**
 * The two buttons under the photo strip, and why they looked wrong.
 *
 * Reported from a handset as the ugliest thing in the app. Two faults, and the
 * first is not about photos at all:
 *
 * **`Secondary` had no horizontal padding.** In a column that is invisible —
 * the button stretches to the panel and the centred label has the whole width
 * to sit in. `Photos` puts two in a `flexDirection: 'row'`, where each shrinks
 * to its own content instead, so the words ended up flat against a hairline
 * border on both sides. Eight files put a `Secondary` in a row, so this was
 * never only here.
 *
 * **And they were shrink-wrapped**, so "Take one" and "Choose one" came out
 * different widths and huddled against the left edge under a full-width
 * thumbnail. Nothing else on these screens does that: every other control is
 * either the panel's width or a row spanning it.
 *
 * Asserted rather than left to the eye because both are invisible on the
 * screens they were developed against, which is exactly how they shipped.
 */

const MACHINE = newId();

async function aMachine(): Promise<void> {
  await enqueue({
    entity: 'equipment',
    op: 'create',
    targetId: MACHINE,
    payload: { name: 'The tractor', hasHourMeter: true },
  });
}

/** Every style object in the tree, flattened — arrays and nesting included. */
function styles(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    node.forEach((n) => styles(n, out));
    return out;
  }
  if (typeof node !== 'object' || node === null) return out;

  const n = node as { props?: { style?: unknown }; children?: unknown };
  const flatten = (s: unknown): void => {
    if (Array.isArray(s)) return void s.forEach(flatten);
    if (typeof s === 'object' && s !== null) out.push(s as Record<string, unknown>);
  };
  if (n.props?.style !== undefined) flatten(n.props.style);
  if (n.children !== undefined) styles(n.children, out);
  return out;
}

/** The subtree rooted at a testID, so a claim is about the right control. */
function byTestID(node: unknown, id: string): unknown {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = byTestID(child, id);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof node !== 'object' || node === null) return null;

  const n = node as { props?: { testID?: string }; children?: unknown };
  if (n.props?.testID === id) return n;
  return n.children === undefined ? null : byTestID(n.children, id);
}

beforeEach(async () => {
  await freshStore();
});

describe('the photo buttons', () => {
  it('gives the words room on both sides', async () => {
    await aMachine();
    const screen = await mount(<MachineScreen {...routeProps({ machineId: MACHINE })} />);
    await screen.press(`photos-open-${MACHINE}`);

    for (const id of ['photo-camera', 'photo-library']) {
      const button = byTestID(screen.tree.toJSON(), id);
      expect(button, id).not.toBeNull();

      const own = styles(button).filter((s) => s.minHeight === TAP.min);
      expect(own.length, `${id} has a tap-sized frame`).toBeGreaterThan(0);
      // The fault: a label flat against a hairline border, because a button in
      // a row is only as wide as its own text.
      expect(own[0]?.paddingHorizontal, `${id} padding`).toBe(SPACE.md);
    }

    screen.unmount();
  });

  /**
   * Equal halves of one row. Different widths is what made them read as two
   * things somebody forgot to lay out rather than one pair.
   */
  it('shares the row equally rather than sizing to its own words', async () => {
    await aMachine();
    const screen = await mount(<MachineScreen {...routeProps({ machineId: MACHINE })} />);
    await screen.press(`photos-open-${MACHINE}`);

    const tree = screen.tree.toJSON();
    for (const id of ['photo-camera', 'photo-library']) {
      const wrapped = styles(parentOf(tree, id)).some((s) => s.flex === 1);
      expect(wrapped, `${id} fills its half`).toBe(true);
    }

    screen.unmount();
  });
});

/** The node holding the one with this testID — where `flex: 1` lives. */
function parentOf(node: unknown, id: string): unknown {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = parentOf(child, id);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof node !== 'object' || node === null) return null;

  const n = node as { props?: { testID?: string }; children?: unknown };
  const kids = Array.isArray(n.children) ? n.children : n.children === undefined ? [] : [n.children];
  for (const child of kids) {
    const c = child as { props?: { testID?: string } } | null;
    if (typeof c === 'object' && c !== null && c.props?.testID === id) return n;
  }
  for (const child of kids) {
    const found = parentOf(child, id);
    if (found !== null) return found;
  }
  return null;
}
