import { beforeEach, describe, expect, it } from 'vitest';
import { Text } from 'react-native';
import { newId } from '@steading/contracts';
import { LAYOUT } from '../../apps/mobile/src/theme/tokens';
import { Screen } from '../../apps/mobile/src/components/Screen';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { seedSecureStore } from '../support/native/modules';

/**
 * The width the app is allowed to become.
 *
 * **A tablet turns.** This used to claim it turned already, because an app
 * targeting Android SDK 36 has its orientation restrictions ignored on displays
 * 600dp and wider — true, and Android 16's behaviour rather than the target
 * level's, so a tablet on API 35 honoured the portrait lock completely and did
 * not turn at all. The manifest has stopped locking and `theme/rotation.ts`
 * re-locks phones only, so a tablet turns for real now — and the cap asserted
 * here is what stands between that and a metre of plaster.
 *
 * Nothing else in the app bounded its width, so a row that reads as a design
 * at 430dp reads as two words at opposite ends of a metre of plaster at
 * 1280dp. This is the cap that stops it, and it is asserted rather than
 * commented because a `maxWidth` with no visible effect on any phone is
 * exactly the line a future reader deletes as dead.
 */

const ORG = newId();

beforeEach(async () => {
  await freshStore();
  seedSecureStore({
    'steading.claims': JSON.stringify({ userId: 'u1', orgId: ORG, role: 'owner' }),
  });
});

/**
 * Every style object in the tree, flattened — arrays and nesting included.
 *
 * `contentContainerStyle` as well as `style`, because the content cap lives on
 * the ScrollView's *container* rather than on the scroll surface, and a helper
 * that read only `style` would report the column missing when it is there.
 */
function styles(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    node.forEach((n) => styles(n, out));
    return out;
  }
  if (typeof node !== 'object' || node === null) return out;

  const n = node as {
    props?: { style?: unknown; contentContainerStyle?: unknown };
    children?: unknown;
  };
  const flatten = (s: unknown): void => {
    if (Array.isArray(s)) return void s.forEach(flatten);
    if (typeof s === 'object' && s !== null) out.push(s as Record<string, unknown>);
  };
  if (n.props?.style !== undefined) flatten(n.props.style);
  if (n.props?.contentContainerStyle !== undefined) flatten(n.props.contentContainerStyle);
  if (n.children !== undefined) styles(n.children, out);
  return out;
}

describe('the reading column', () => {
  it('caps the content at the column and centres it', async () => {
    const screen = await mount(
      <Screen title="Today">
        <Text>a row</Text>
      </Screen>,
    );

    const capped = styles(screen.tree.toJSON()).filter(
      (s) => s.maxWidth === LAYOUT.column,
    );

    /**
     * Both, and the pairing is the point: capping only the content would leave
     * the lamp and the settings gear at the far edge of a 1280dp screen
     * pointing at a column in the middle of it.
     */
    expect(capped.length).toBeGreaterThanOrEqual(2);
    for (const s of capped) {
      // Capped without `width: '100%'` a flex child shrinks to its content,
      // which would break every full-width row on the phones this is drawn for.
      expect(s.width).toBe('100%');
    }

    /**
     * Centred two different ways, on purpose.
     *
     * The status bar is a plain flex child, so `alignSelf` is ordinary
     * flexbox. The content column is inside a `NativeScrollContentView` whose
     * width the native scroll view has a hand in — so it is centred by its
     * *container* rather than by itself, which cannot depend on internals.
     */
    const all = styles(screen.tree.toJSON());
    expect(all.some((s) => s.maxWidth === LAYOUT.column && s.alignSelf === 'center')).toBe(true);
    expect(all.some((s) => s.alignItems === 'center' && s.flexGrow === 1)).toBe(true);
    screen.unmount();
  });

  /**
   * The wall is not the column.
   *
   * `Plaster` is the texture behind everything and the ground is what it sits
   * on; both must still reach the edges of a tablet. A cap that leaked onto
   * them would letterbox the app in bare background — the failure this change
   * would most plausibly introduce.
   */
  it('does not cap the ground the column is drawn on', async () => {
    const screen = await mount(
      <Screen title="Today">
        <Text>a row</Text>
      </Screen>,
    );

    const root = screen.tree.toJSON();
    const rootStyles = styles(Array.isArray(root) ? root[0] : root).slice(0, 1);

    expect(rootStyles[0]?.maxWidth).toBeUndefined();
    expect(rootStyles[0]?.flex).toBe(1);
    screen.unmount();
  });

  it('is a real number, not a placeholder', () => {
    // 600 is Android's own threshold for calling a display large, so the app
    // fills anything below it and stops growing at exactly the point the
    // platform stops guaranteeing portrait.
    expect(LAYOUT.column).toBe(600);
  });
});
