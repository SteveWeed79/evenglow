import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { seedWindow } from '../support/native/react-native';
import { seedInsets, seedSecureStore } from '../support/native/modules';
import { Surface } from '../../apps/mobile/src/components/Surface';
import { Primary } from '../../apps/mobile/src/components/Form';
import { Screen } from '../../apps/mobile/src/components/Screen';
import { GrowingScreen } from '../../apps/mobile/src/screens/GrowingScreen';
import { IronScreen } from '../../apps/mobile/src/screens/IronScreen';
import { StockScreen } from '../../apps/mobile/src/screens/StockScreen';

/**
 * The motif, which is light now rather than a shape.
 *
 * This file used to assert the opposite. The arch was the one shape the app was
 * built from, load bearing rather than decorative — **arch = something you can
 * act on** — and these tests held every hub to it after the motif was found
 * shipping on the Tally alone.
 *
 * It was removed, on the farmer's call, because it does not scale: the head is
 * `w / 2` across and a fixed 32 down, so on a card 500dp wide the ellipse is
 * shallow enough to read as a warped top edge rather than a doorway. The lamp
 * glow moved onto every card in its place, which reverses the *"no gradients
 * beyond the single lamp glow"* line UX-SPEC §2 carried — the spec has been
 * rewritten to match rather than left disagreeing with the code.
 *
 * ## What this can prove
 *
 * The same half it always could. Nothing here measures a curve or a corner —
 * `theme/surface.ts` holds the geometry and is tested on its own numbers. What
 * this asserts is which things are *painted and lit* rather than styled flat,
 * which is the design rule rather than the shape, and it is still the half that
 * regresses silently: a new hub card is a `<Touch>` around a plain rounded
 * rectangle unless somebody remembers it should not be.
 *
 * **And the glow is asserted, not just the surface.** `<Surface>` renders
 * perfectly well with `glow` undefined — that is what chips and the primary
 * button's flat face want — so a card that lost its light would still be a
 * `<Surface>` and would still pass a test that only counted them.
 */

/**
 * Every surface on the tree that is actually carrying light.
 *
 * Typed off what the renderer returns rather than off `SurfaceProps`: a test
 * instance's props are an index signature, so asking for the component's own
 * prop type here would be asserting something the tree cannot promise.
 */
function lit(root: {
  findAllByType: (t: typeof Surface) => { props: Record<string, unknown> }[];
}): { props: Record<string, unknown> }[] {
  return root.findAllByType(Surface).filter((s) => s.props.glow !== undefined);
}

const TABLET = { width: 800, height: 1280 };

beforeEach(async () => {
  await freshStore();
  seedWindow();
  seedInsets();
  seedSecureStore({
    'homefarm.claims': JSON.stringify({ userId: 'u1', orgId: newId(), role: 'owner' }),
  });
});

describe('the button every screen ends with', () => {
  it('is painted rather than styled flat', async () => {
    const screen = await mount(
      <Screen title="Stock" back>
        <Primary label="Add another group" onPress={() => undefined} />
      </Screen>,
    );

    // One painted face, on the one control. A primary action is the most
    // actionable thing on any screen in this app, so if anything is lit it is.
    expect(screen.tree.root.findAllByType(Surface)).toHaveLength(1);
    screen.unmount();
  });
});

describe('a hub card', () => {
  /** Two of each, because `<Grid>` renders no grid for a single cell. */
  beforeEach(async () => {
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

  const hubs: [string, () => React.ReactElement][] = [
    ['Stock', StockScreen],
    ['Iron', IronScreen],
    ['Growing', GrowingScreen],
  ];

  for (const [name, Hub] of hubs) {
    it(`is lit on ${name}`, async () => {
      seedWindow(TABLET);
      const screen = await mount(<Hub />);

      /**
       * Two cards, so two lit faces at least — the primary action under them is
       * a `<Surface>` too but takes no glow, which is why this counts the lit
       * ones rather than every surface on the tree.
       *
       * A floor rather than an exact count: a hub is free to grow another card,
       * and a test that forbade it would be asserting the opposite of the rule.
       */
      expect(lit(screen.tree.root).length, name).toBeGreaterThanOrEqual(2);
      screen.unmount();
    });
  }
});
