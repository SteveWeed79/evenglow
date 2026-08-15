import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import { ThemeProvider } from '../../apps/mobile/src/theme/ThemeProvider';
import { freshStore } from '../support/store';
import { seedSecureStore } from '../support/native/modules';
import type { CachedClaims } from '../../apps/mobile/src/auth/session';

/**
 * The screens go away before the farm does (P1-5, the last uncovered case).
 *
 * The generation fence protects sync, which is where the cross-tenant *write*
 * lived. It says nothing about a screen that is already on screen when the
 * swap happens: a hook that read the store, awaited, and came back would be
 * holding the previous farm's handle.
 *
 * `Boot` is what closes that, and until now it was closed by **reasoning about
 * React** rather than by anything asserted — the work list said so, and said it
 * needed a device. Half of it does not. The claim "`Boot` re-renders through
 * `opening` on both paths, so the screens unmount" is a claim about this
 * component, and this component mounts here.
 *
 * What still needs a handset is the other half: that no native module holds a
 * reference across the swap. That is not a thing a test renderer can answer,
 * and it is not what this file claims to.
 */

/**
 * The store swap, held open by the test rather than by a slow disk.
 *
 * `openLocalStore` is what `Boot` awaits on both transitions, so this is the
 * seam that lets the window be looked at while it is open. Mocked rather than
 * driven, because the point is the component's rendering during the wait, and
 * a real open on a memory database finishes before anything can be observed.
 */
const swap = vi.hoisted(() => ({
  open: (): Promise<unknown> => Promise.resolve({}),
}));

vi.mock('../../apps/mobile/src/db/store', () => ({
  openLocalStore: () => swap.open(),
  disposeWhenClosed: () => {},
  disposeIfMarked: () => Promise.resolve(false),
  resetLocalStoreHandle: () => {},
}));

vi.mock('../../apps/mobile/src/auth/local-org', () => ({
  ensureLocalOrgId: () => Promise.resolve('01J000000000000000000OWN1'),
}));

vi.mock('../../apps/mobile/src/boot/start', () => ({
  start: () => Promise.resolve({ stop: () => {} }),
}));

vi.mock('@steading/core/sync/engine', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  startSync: () => () => {},
}));

vi.mock('../../apps/mobile/src/theme/fonts', () => ({
  useAppFonts: () => ({ ready: true }),
}));

const { Boot } = await import('../../apps/mobile/src/Boot');

/** A screen that says whether it is mounted, which is the whole question. */
function Screen({ onMount }: { onMount: (mounted: boolean) => void }): React.ReactElement {
  onMount(true);
  return <></>;
}

beforeEach(async () => {
  await freshStore();
  seedSecureStore({});
  swap.open = () => Promise.resolve({});
});

describe('a farm swap under a running app', () => {
  it('takes the screens down before it opens the other farm', async () => {
    /**
     * Held open, so the transition can be observed while it is happening
     * rather than only after. This is the window the work list could not say
     * anything about.
     */
    let release!: () => void;
    const opening = new Promise<void>((resolve) => {
      release = resolve;
    });

    let handlers!: { onSignedIn: (claims: CachedClaims) => void; onSignedOut: () => void };
    let mounted = false;

    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <ThemeProvider>
          <Boot
            render={(h) => {
              handlers = h;
              return <Screen onMount={() => (mounted = true)} />;
            }}
          />
        </ThemeProvider>,
      );
    });
    for (let i = 0; i < 4; i++) await act(async () => {});

    expect(mounted).toBe(true);

    // The swap begins and does not finish.
    swap.open = async () => {
      await opening;
      return {};
    };
    mounted = false;

    await act(async () => {
      handlers.onSignedIn({
        userId: '01J000000000000000000USR1',
        orgId: '01J000000000000000000ORG2',
        role: 'owner',
      });
    });

    /**
     * The app tree is gone, replaced by the boot mark. That is what makes the
     * hazard unreachable rather than merely unlikely: a screen cannot hold a
     * stale handle across an await it is no longer alive to return from.
     */
    expect(tree.root.findAllByProps({ testID: 'boot-mark' }).length).toBeGreaterThan(0);
    expect(mounted).toBe(false);

    await act(async () => {
      release();
    });
    for (let i = 0; i < 4; i++) await act(async () => {});

    // And it comes back, so this is an unmount rather than a hang.
    expect(mounted).toBe(true);
    tree.unmount();
  });

  it('does the same on the way out, when a hand signs off a shared tablet', async () => {
    let release!: () => void;
    const opening = new Promise<void>((resolve) => {
      release = resolve;
    });

    let handlers!: { onSignedIn: (claims: CachedClaims) => void; onSignedOut: () => void };
    let mounted = false;

    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <ThemeProvider>
          <Boot
            render={(h) => {
              handlers = h;
              return <Screen onMount={() => (mounted = true)} />;
            }}
          />
        </ThemeProvider>,
      );
    });
    for (let i = 0; i < 4; i++) await act(async () => {});
    expect(mounted).toBe(true);

    swap.open = async () => {
      await opening;
      return {};
    };
    mounted = false;

    await act(async () => {
      handlers.onSignedOut();
    });

    // The employer's records are off the screen before the device's own farm
    // is open — which is P1-5(a) seen from the rendering side.
    expect(tree.root.findAllByProps({ testID: 'boot-mark' }).length).toBeGreaterThan(0);
    expect(mounted).toBe(false);

    await act(async () => {
      release();
    });
    for (let i = 0; i < 4; i++) await act(async () => {});
    expect(mounted).toBe(true);
    tree.unmount();
  });
});
