import { describe, expect, it } from 'vitest';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { act } from 'react';
import { Icon } from '../../apps/mobile/src/components/Icon';

/**
 * The lamp in the header, and the one thing about it that fails silently.
 *
 * The mark is now a filled lantern rather than a ring, and the lit state is
 * said with paint: `lanternInk` over a `RadialGradient` halo. That halo is the
 * part with a trap in it — SVG gradient ids are global to the document, so two
 * glowing marks on one screen both resolve `url(#…)` to whichever rendered
 * last. `Arch.tsx` hit exactly this and fixed it with `useId`; the fix is now
 * in a second place and wants holding down in both.
 *
 * It fails as *wrong paint*, never as an error — the second lamp simply takes
 * the first one's gradient — so nothing but an assertion catches it.
 */

function render(node: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(node);
  });
  return tree;
}

/** Every prop of every node of this type, anywhere in the tree. */
function propsOf(tree: ReactTestRenderer, type: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return void node.forEach(walk);
    if (typeof node !== 'object' || node === null) return;
    const n = node as { type?: string; props?: Record<string, unknown>; children?: unknown };
    if (n.type === type && n.props !== undefined) out.push(n.props);
    if (n.children !== undefined) walk(n.children);
  };
  walk(tree.toJSON());
  return out;
}

describe('the lamp mark', () => {
  it('fills the lantern rather than stroking it', () => {
    const tree = render(<Icon name="lamp-lit" size={40} color="#e9b23c" />);

    const paths = propsOf(tree, 'Path');
    expect(paths).toHaveLength(1);
    // A stroked silhouette is the failure the old ring was chosen to avoid:
    // at this density the outline closes up and the mark goes solid anyway.
    expect(paths[0]?.fill).toBe('#e9b23c');
    expect(paths[0]?.stroke).toBe('none');
    tree.unmount();
  });

  it('is the same drawing lit or unlit', () => {
    const lit = render(<Icon name="lamp-lit" size={40} color="#e9b23c" />);
    const unlit = render(<Icon name="lamp-unlit" size={40} color="#c0b8a8" />);

    // One object in two states. Two names carrying two *drawings* is what
    // would let them drift, so they share a constant and this proves it.
    expect(propsOf(lit, 'Path')[0]?.d).toBe(propsOf(unlit, 'Path')[0]?.d);
    lit.unmount();
    unlit.unmount();
  });

  it('draws no halo unless one is asked for', () => {
    const tree = render(<Icon name="lamp-unlit" size={40} color="#c0b8a8" />);

    expect(propsOf(tree, 'RadialGradient')).toHaveLength(0);
    expect(propsOf(tree, 'Circle')).toHaveLength(0);
    tree.unmount();
  });

  it('puts the halo behind the mark, inside the viewBox', () => {
    const tree = render(<Icon name="lamp-lit" size={40} color="#e9b23c" glow="#e9b23c" />);

    const circles = propsOf(tree, 'Circle');
    expect(circles).toHaveLength(1);

    /**
     * Radius exactly half the viewBox, so the outermost stop lands on the edge
     * at zero alpha. A halo drawn wider does not spill — react-native-svg clips
     * to the viewBox and Android clips child views harder still — it gets cut,
     * and a cut gradient reads as a square of haze around the lamp.
     */
    expect(circles[0]?.r).toBe(16);
    expect(circles[0]?.cx).toBe(16);
    expect(circles[0]?.cy).toBe(16);
    tree.unmount();
  });

  /**
   * The regression, and it needs two of them on screen to show itself.
   *
   * One lamp always looks right, which is why this is asserted rather than
   * eyeballed: the app has a single header today, and the bug would arrive the
   * first time anything else asked for a glow.
   */
  it('gives every instance its own gradient id', () => {
    const tree = render(
      <>
        <Icon name="lamp-lit" size={40} color="#e9b23c" glow="#e9b23c" />
        <Icon name="lamp-lit" size={40} color="#e9b23c" glow="#e9b23c" />
      </>,
    );

    const ids = propsOf(tree, 'RadialGradient').map((p) => p.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);

    // And a colon is not reachable through `url(#…)` — React's useId returns
    // `:r0:`, so the strip is load-bearing rather than cosmetic.
    for (const id of ids) expect(String(id)).not.toContain(':');

    // Each halo must point at its own gradient, not at a shared name.
    const fills = propsOf(tree, 'Circle').map((p) => p.fill);
    expect(new Set(fills).size).toBe(2);
    tree.unmount();
  });
});
