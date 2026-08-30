import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { seedWindow } from '../support/native/react-native';
import { seedInsets, seedSecureStore } from '../support/native/modules';
import { Arch } from '../../apps/mobile/src/components/Arch';
import { Primary } from '../../apps/mobile/src/components/Form';
import { Screen } from '../../apps/mobile/src/components/Screen';
import { GrowingScreen } from '../../apps/mobile/src/screens/GrowingScreen';
import { IronScreen } from '../../apps/mobile/src/screens/IronScreen';
import { StockScreen } from '../../apps/mobile/src/screens/StockScreen';

/**
 * The motif, spent.
 *
 * UX-SPEC §2 makes the arch the one shape the app is built from — *"every
 * card, the Tally frame, primary buttons, sheets, and the empty-state panels
 * are arched at the top and squared at the base... makes the app recognizable
 * from across a room"* — and it is load bearing rather than decorative:
 * **arch = something you can act on**, a flat rectangle is read-only.
 *
 * It shipped on the Tally and nowhere else. `ArchPanel` was written and never
 * called; the hub cards were rounded rectangles; `Primary`, the button every
 * screen ends with, was `RADII.softHead`. So the single arch in the app read
 * as an oddity rather than a motif, which is exactly how it was reported off
 * the tablet: the arch cards feel out of place. There was one of them.
 *
 * ## What this can prove
 *
 * Nothing here measures a curve — `theme/arch.ts` holds the geometry and is
 * tested on its own numbers. What this asserts is which things *wear a door*,
 * which is the half that is a design rule rather than a shape, and the half
 * that regresses silently: a new hub card is a `<Touch>` around a rounded
 * rectangle unless somebody remembers it should not be.
 */

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
  it('wears a door', async () => {
    const screen = await mount(
      <Screen title="Stock" back>
        <Primary label="Add another group" onPress={() => undefined} />
      </Screen>,
    );

    // One arch, on the one control. A primary action is the most actionable
    // thing on any screen in this app, so if anything is a doorway it is.
    expect(screen.tree.root.findAllByType(Arch)).toHaveLength(1);
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
    it(`is a doorway on ${name}`, async () => {
      seedWindow(TABLET);
      const screen = await mount(<Hub />);

      /**
       * Two cards and the primary action under them, so three doors at least.
       * A floor rather than an exact count: a hub is free to grow another
       * arched thing, and a test that forbade it would be asserting the
       * opposite of what the spec asks for.
       */
      expect(screen.tree.root.findAllByType(Arch).length, name).toBeGreaterThanOrEqual(3);
      screen.unmount();
    });
  }
});
