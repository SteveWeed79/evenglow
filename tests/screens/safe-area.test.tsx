import { beforeEach, describe, expect, it } from 'vitest';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { SupportScreen } from '../../apps/mobile/src/screens/SupportScreen';
import { SPACE } from '../../apps/mobile/src/theme/tokens';

/**
 * The system bar at the bottom of a handset, and the centimetre it was taking.
 *
 * `Screen` applied `paddingTop: insets.top` and nothing for the bottom, so on a
 * phone with gesture navigation the pill sat over whatever was at the end of the
 * scroll. Reported from a test phone as the bar covering the last few percent of
 * every screen.
 *
 * **It is worst exactly where it hurts most.** R3 puts primary actions in the
 * bottom third, so the thing under the bar is the button — on a sign-in screen,
 * the one somebody is trying to press.
 *
 * Two things let it get to a second device. It does not show on the tablet this
 * was developed against, and `TabDividers` already reads `insets.bottom`, so the
 * knowledge was in the codebase one file away from the place that needed it.
 *
 * The stub reports `bottom: 16` (`tests/support/native/modules.tsx`), which is
 * what makes this assertable at all — a real inset is a device fact.
 */

const INSET_BOTTOM = 16;

/** Every style object in the tree, flattened. */
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

/**
 * The style array of the first element whose styles mention `paddingBottom`,
 * in the order React Native will merge them — last wins.
 */
function withPaddingBottom(node: unknown): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = withPaddingBottom(child);
      if (found.length > 0) return found;
    }
    return [];
  }
  if (typeof node !== 'object' || node === null) return [];

  const n = node as { props?: { style?: unknown }; children?: unknown };
  const own: Record<string, unknown>[] = [];
  const flatten = (s: unknown): void => {
    if (Array.isArray(s)) return void s.forEach(flatten);
    if (typeof s === 'object' && s !== null) own.push(s as Record<string, unknown>);
  };
  flatten(n.props?.style);

  if (own.some((s) => s.paddingBottom !== undefined)) return own;
  return n.children === undefined ? [] : withPaddingBottom(n.children);
}

beforeEach(async () => {
  await freshStore();
});

describe('the bottom of the screen', () => {
  it('leaves room for the system bar under the content', async () => {
    const screen = await mount(<SupportScreen />);

    const all = styles(screen.tree.toJSON());
    // The content column carries the padding, so the inset is scrollable space
    // at the end rather than a dead band the app may not draw into.
    const padded = all.filter((s) => s.paddingBottom === SPACE.xl + INSET_BOTTOM);

    expect(padded.length, 'no element reserves the bottom inset').toBeGreaterThan(0);

    screen.unmount();
  });

  /**
   * The override has to come after the base in the style array or it does not
   * win, and both objects are in the tree either way — asserting on the
   * presence of one proves nothing about which React Native applies.
   */
  it('applies the inset after the base padding, so it is the one that wins', async () => {
    const screen = await mount(<SupportScreen />);

    const column = withPaddingBottom(screen.tree.toJSON());
    expect(column, 'the content column was not found').not.toBeNull();

    const base = column.findIndex((s) => s.paddingBottom === SPACE.xl);
    const inset = column.findIndex((s) => s.paddingBottom === SPACE.xl + INSET_BOTTOM);

    expect(inset, 'nothing reserves the inset').toBeGreaterThan(-1);
    if (base !== -1) expect(inset, 'the inset is overridden by the base').toBeGreaterThan(base);

    screen.unmount();
  });

  /** The top inset was already right, and must stay so. */
  it('still leaves room for the status bar above', async () => {
    const screen = await mount(<SupportScreen />);

    const all = styles(screen.tree.toJSON());
    expect(all.some((s) => s.paddingTop === 24)).toBe(true);

    screen.unmount();
  });
});
