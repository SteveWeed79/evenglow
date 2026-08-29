import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import { ThemeProvider } from '../../apps/mobile/src/theme/ThemeProvider';
import { networkListeners, resetNetworkListeners } from '../support/native/modules';
import type { CachedClaims } from '../../apps/mobile/src/auth/session';

/**
 * The sync triggers after an ordinary first sign-in.
 *
 * ## The device this is about
 *
 * A farm installs the app and uses it. There is no account, so `start()` takes
 * the no-account branch — correctly, because there is nothing to flush to —
 * and that branch attaches no triggers. Weeks later the farmer signs in from
 * My Farm to claim the farm. `Boot.onSignedIn` opens the store and starts the
 * loop, and `start()` never runs again for the life of the process.
 *
 * So nothing ever attached the AppState and `expo-network` listeners. The
 * engine still ticked, so no record was lost — what was lost is the reason the
 * two triggers exist at all: **Android freezes the process, so the idle tick
 * does not run while the app is away.** Resume is the only moment the engine
 * reliably hears about, and it was heard by nobody. A phone carried out of the
 * barn and unlocked shows "12 waiting" until the loop happens to come round,
 * which `sync/triggers.ts` calls the way an app teaches somebody not to trust
 * it.
 *
 * ## Counted, not observed
 *
 * A listener that is attached looks exactly like one that is not, from
 * outside. The only thing that can be asserted is how many the module holds —
 * which is also the assertion the second half needs, because signing out and
 * back in must not stack a second one.
 */

const start = vi.hoisted(() => ({
  run: (): Promise<{ stop: () => void }> => Promise.resolve({ stop: () => undefined }),
}));

vi.mock('../../apps/mobile/src/boot/start', () => ({
  start: () => start.run(),
}));

/**
 * The store, mocked because this file is about the listeners either side of
 * opening one, not about the open. `Boot` awaits it on both transitions.
 */
vi.mock('../../apps/mobile/src/db/store', () => ({
  openLocalStore: () => Promise.resolve({}),
  disposeWhenClosed: () => undefined,
  disposeIfMarked: () => Promise.resolve(false),
  resetLocalStoreHandle: () => undefined,
}));

vi.mock('../../apps/mobile/src/auth/local-org', () => ({
  ensureLocalOrgId: () => Promise.resolve('01J000000000000000000OWN1'),
}));

vi.mock('@homefarm/core/sync/engine', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  startSync: () => undefined,
  stopSync: () => undefined,
}));

vi.mock('../../apps/mobile/src/theme/fonts', () => ({
  useAppFonts: () => ({ ready: true }),
}));

const { Boot } = await import('../../apps/mobile/src/Boot');
const { stopTriggers } = await import('../../apps/mobile/src/sync/triggers');

const CLAIMS: CachedClaims = {
  userId: '01J000000000000000000US1',
  orgId: '01J000000000000000000ORG',
  role: 'owner',
};

interface Session {
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  unmount: () => void;
}

/** Mounts `Boot` down the no-account path and hands back its two callbacks. */
async function mountBoot(): Promise<Session> {
  let tree!: ReturnType<typeof create>;
  let session: { onSignedIn: (c: CachedClaims) => void; onSignedOut: () => void } | null = null;

  await act(async () => {
    tree = create(
      <ThemeProvider>
        <Boot
          render={(handles) => {
            session = handles;
            return <></>;
          }}
        />
      </ThemeProvider>,
    );
  });

  const settle = async (): Promise<void> => {
    await act(async () => {
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
    });
  };

  await settle();

  const held = session as unknown as {
    onSignedIn: (c: CachedClaims) => void;
    onSignedOut: () => void;
  };

  return {
    signIn: async () => {
      await act(async () => held.onSignedIn(CLAIMS));
      await settle();
    },
    signOut: async () => {
      await act(async () => held.onSignedOut());
      await settle();
    },
    unmount: () => tree.unmount(),
  };
}

beforeEach(() => {
  // The triggers are one set per process, and a process here is the whole
  // file. Released so each case starts from nothing attached.
  stopTriggers();
  resetNetworkListeners();
  start.run = () => Promise.resolve({ stop: () => undefined });
});

describe('the sync triggers across a session', () => {
  /**
   * The premise, asserted rather than assumed. If the no-account boot did
   * attach them, the finding below would not exist and this file would be
   * testing nothing.
   */
  it('attaches nothing on a boot with no account', async () => {
    const session = await mountBoot();

    expect(networkListeners).toHaveLength(0);
    session.unmount();
  });

  /** The finding. */
  it('attaches them when the farm signs in', async () => {
    const session = await mountBoot();
    await session.signIn();

    expect(networkListeners).toHaveLength(1);
    session.unmount();
  });

  /**
   * And exactly one, however many times a session turns over.
   *
   * A second AppState listener on top of the first fires `wake()` twice per
   * resume — two `refreshSession()` calls racing for one rotating refresh
   * token. The server revokes the whole family on reuse, which is right when
   * it is a stolen token and catastrophic when it is this app racing itself:
   * the farm is asked for a password in a barn, having done nothing but open
   * the app. That is the bug `refreshSession` is single-flight to prevent, and
   * stacking listeners would reintroduce it from the other end.
   */
  it('keeps one set across signing out and back in', async () => {
    const session = await mountBoot();

    await session.signIn();
    await session.signOut();
    await session.signIn();

    expect(networkListeners).toHaveLength(1);
    session.unmount();
  });

});
