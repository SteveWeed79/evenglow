import { beforeEach, describe, expect, it } from 'vitest';
import { Text } from 'react-native';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { DiagnosticsScreen } from '../../apps/mobile/src/screens/DiagnosticsScreen';

/**
 * The two values on this screen that somebody has to reproduce exactly.
 *
 * `Farm id` sat in a row beside its label under `numberOfLines={1}`, so a
 * 26-character ULID drew as `01KYJB4K0KFKTD3K7JSAY5T4…` — and was read off the
 * screen exactly like that, ellipsis included, into `pnpm farm:show`, which
 * correctly answered that no such farm exists. The id was never wrong. The
 * screen only ever showed part of it, on the one row whose own comment calls
 * it "the thing to read out".
 *
 * Asserted structurally rather than against the text, because the truncation
 * happened in React Native's layout — the stub renders the whole string, so
 * the rendered output looked fine here while a handset clipped it. The defect
 * was the props, so the props are what this checks.
 */

/** Every `Text` the screen renders, whatever it is nested in. */
function texts(screen: Awaited<ReturnType<typeof mount>>) {
  return screen.tree.root.findAllByType(Text);
}

beforeEach(async () => {
  await freshStore();
});

describe('the identifiers on this screen', () => {
  it('offers both of them to be copied rather than transcribed', async () => {
    const screen = await mount(<DiagnosticsScreen />);

    // A phone in a barn and an id going onto a laptop: long-press and copy is
    // the only version of that which cannot go wrong.
    const selectable = texts(screen).filter((node) => node.props.selectable === true);

    expect(selectable.length).toBeGreaterThanOrEqual(2);
    screen.unmount();
  });

  it('never clips one to a single line', async () => {
    const screen = await mount(<DiagnosticsScreen />);

    // The exact combination that produced the ellipsis: a value meant to be
    // read out, capped at one line in a row that also holds its label.
    const clipped = texts(screen).filter(
      (node) => node.props.selectable === true && node.props.numberOfLines !== undefined,
    );

    expect(clipped).toHaveLength(0);
    screen.unmount();
  });
});
