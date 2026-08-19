import { beforeEach, describe, expect, it } from 'vitest';
import { Text } from 'react-native';
import { newId } from '@homefarm/contracts';
import { LAYOUT, SPACE } from '../../apps/mobile/src/theme/tokens';
import { Screen } from '../../apps/mobile/src/components/Screen';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { seedInsets, seedSecureStore } from '../support/native/modules';

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
 *
 * ## What `wide` added, and why it does not undo any of the above
 *
 * Two kinds of screen have since been let out to `LAYOUT.wide` — the charts,
 * which have no line length to ruin, and the hub grids, which are equivalent
 * things rather than prose. The cap is not gone for them; it is a different
 * cap, and it is still a cap. Both are asserted below, because "the column
 * grew a way to be opted out of" is precisely the change that would let it
 * quietly become no column at all.
 */

const ORG = newId();

beforeEach(async () => {
  await freshStore();
  // Upright unless a test says otherwise. Reset here rather than inside
  // `mount`, which runs after a test has already seeded and would undo it.
  seedInsets();
  seedSecureStore({
    'homefarm.claims': JSON.stringify({ userId: 'u1', orgId: ORG, role: 'owner' }),
  });
});

/**
 * Every element's *effective* style, arrays and nesting flattened per element.
 *
 * One object per element rather than one per fragment, which is the correction
 * this helper needed when the cap moved inline: `[styles.content, { maxWidth }]`
 * is one element's style in two pieces, and a helper that pushed the pieces
 * separately reported an element that was capped *and* full-width as two
 * elements that were each only one of those. The layout engine merges them, so
 * this does too.
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

  for (const key of ['style', 'contentContainerStyle'] as const) {
    const value = n.props?.[key];
    if (value === undefined) continue;

    const merged: Record<string, unknown> = {};
    const flatten = (s: unknown): void => {
      if (Array.isArray(s)) return void s.forEach(flatten);
      if (typeof s === 'object' && s !== null) Object.assign(merged, s);
    };
    flatten(value);
    if (Object.keys(merged).length > 0) out.push(merged);
  }

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

    const capped = styles(screen.tree.toJSON()).filter((s) => s.maxWidth === LAYOUT.column);

    /**
     * **The content, and only the content.**
     *
     * This asserted two capped elements, and the pairing was argued for:
     *
     * > *Both, and the pairing is the point: capping only the content would
     * > leave the lamp and the settings gear at the far edge of a 1280dp screen
     * > pointing at a column in the middle of it.*
     *
     * That cost is real and it is now being paid deliberately. What the pairing
     * bought was worse, because `cap` is `wide ? LAYOUT.wide : LAYOUT.column` —
     * so the bar followed the *content's* measure and moved between screens.
     * Settings and Iron put the chevron at the window's edge; Machines, Animals
     * and every form pulled it in to 600dp. A control that changes position as
     * you navigate is the thing a hand actually notices, and it was reported
     * from the tablet before anybody minded the lamp being far from the text.
     *
     * A measure is for prose. Chrome belongs to the window.
     */
    expect(capped).toHaveLength(1);
    for (const s of capped) {
      // Capped without `width: '100%'` a flex child shrinks to its content,
      // which would break every full-width row on the phones this is drawn for.
      expect(s.width).toBe('100%');
    }

    /**
     * The content column is inside a `NativeScrollContentView` whose width the
     * native scroll view has a hand in — so it is centred by its *container*
     * rather than by itself, which cannot depend on internals.
     */
    const all = styles(screen.tree.toJSON());
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

describe('a wide screen', () => {
  /**
   * `wide` moves the content's cap; it does not remove it, and it no longer
   * moves the bar with it — the bar has no cap to move.
   *
   * This used to assert both together, on the argument that a hub whose content
   * reached 1104 while its status row stayed at 600 would put the gear in the
   * middle of its own content. True of a bar that is capped at all; the answer
   * taken was to stop capping it, so the bar is at the window's edge on this
   * screen and on every other one.
   */
  it('moves the content cap out to LAYOUT.wide, and leaves the bar alone', async () => {
    const screen = await mount(
      <Screen title="The farm" wide>
        <Text>a row</Text>
      </Screen>,
    );

    const all = styles(screen.tree.toJSON());
    const capped = all.filter((s) => s.maxWidth === LAYOUT.wide);

    expect(capped).toHaveLength(1);
    for (const s of capped) expect(s.width).toBe('100%');

    // And nothing is left behind at the narrow cap, which is what a change
    // that widened only one of the two would look like.
    expect(all.some((s) => s.maxWidth === LAYOUT.column)).toBe(false);
    screen.unmount();
  });

  /**
   * The bar is the same width whatever the screen is, which is the whole point
   * of the change above and the thing a person sees.
   */
  it('puts the bar in the same place on a wide screen as on a narrow one', async () => {
    const narrow = await mount(
      <Screen title="Machines">
        <Text>a row</Text>
      </Screen>,
    );
    const wide = await mount(
      <Screen title="The farm" wide>
        <Text>a row</Text>
      </Screen>,
    );

    const barOf = (screen: Awaited<ReturnType<typeof mount>>) =>
      styles(screen.tree.toJSON()).find(
        (s) => s.justifyContent === 'space-between' && s.width === '100%',
      );

    // Neither carries a cap, so neither can disagree with the other about where
    // the chevron sits.
    expect(barOf(narrow)?.maxWidth).toBeUndefined();
    expect(barOf(wide)?.maxWidth).toBeUndefined();

    narrow.unmount();
    wide.unmount();
  });

  it('is still a cap, and still the one the panes will use', () => {
    expect(LAYOUT.wide).toBe(LAYOUT.column + LAYOUT.spacer + LAYOUT.aside.max);
    expect(LAYOUT.wide).toBeGreaterThan(LAYOUT.column);
  });
});

/**
 * The gap the wasted space was hiding.
 *
 * `insets.left` and `insets.right` were read nowhere in this app. Top and
 * bottom cover a phone completely, because in portrait the cutout and the
 * gesture bar are both on the short edges — but the app turns on a tablet, and
 * in landscape they move to a side edge where nothing was reserving for them.
 *
 * It survived because the content sat 340dp from either edge with nothing in
 * between. `wide` is what spends that margin, so this had to land in the same
 * pass rather than after somebody found it on a device.
 */
describe('a landscape cutout', () => {
  const CUT = { left: 48, right: 24 };

  it('keeps the content out from under it', async () => {
    seedInsets(CUT);
    const screen = await mount(
      <Screen title="The farm" wide>
        <Text>a row</Text>
      </Screen>,
    );

    const all = styles(screen.tree.toJSON());

    // On the scroll's container, so the column centres inside the safe area
    // rather than inside the window.
    expect(
      all.some((s) => s.paddingLeft === CUT.left && s.paddingRight === CUT.right),
    ).toBe(true);

    // And on the status row, added to its own padding rather than replacing
    // it — the gear must clear the cutout AND keep its margin.
    expect(
      all.some(
        (s) =>
          s.paddingLeft === SPACE.lg + CUT.left && s.paddingRight === SPACE.lg + CUT.right,
      ),
    ).toBe(true);

    screen.unmount();
  });

  /**
   * And the wall still reaches the edge.
   *
   * The tempting fix is `paddingHorizontal` on the ground, which is one line
   * shorter and wrong: `<Plaster />` is an `absoluteFill` inside it, so the
   * padding would inset the texture too and letterbox the app in bare
   * background. That is the same thing the ground test above guards, arriving
   * from a different direction.
   */
  it('does not inset the wall', async () => {
    seedInsets(CUT);
    const screen = await mount(
      <Screen title="The farm" wide>
        <Text>a row</Text>
      </Screen>,
    );

    const root = screen.tree.toJSON();
    const ground = styles(Array.isArray(root) ? root[0] : root)[0];

    expect(ground?.flex).toBe(1);
    expect(ground?.paddingLeft).toBeUndefined();
    expect(ground?.paddingRight).toBeUndefined();
    expect(ground?.paddingHorizontal).toBeUndefined();
    screen.unmount();
  });

  it('reserves nothing on a phone, which is every device that does not turn', async () => {
    const screen = await mount(
      <Screen title="Today">
        <Text>a row</Text>
      </Screen>,
    );

    // The default stub is a portrait handset: left and right are zero, so this
    // whole change is a no-op on the shipping case and cannot regress it.
    const all = styles(screen.tree.toJSON());
    expect(all.some((s) => s.paddingLeft === SPACE.lg && s.paddingRight === SPACE.lg)).toBe(true);
    screen.unmount();
  });
});
