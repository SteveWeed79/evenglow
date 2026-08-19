import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';
import { currentAccessToken, resetApiBase, setAccessToken, setApiBase } from '@homefarm/core/api';
import { localStore } from '@homefarm/core/db/store';
import { freshStore } from '../support/store';
import { seedSecureStore } from '../support/native/modules';
import {
  readCachedClaims,
  refreshSession,
  signIn,
  signOut,
} from '../../apps/mobile/src/auth/session';

/**
 * Signing out while a refresh is in the air (P1-4(c)).
 *
 * `refreshSession` is single-flight against other refreshes and was fenced
 * against nothing else. It reads a token, posts it, and writes credentials
 * back, and every one of those steps is an await — so a sign-out landing inside
 * the round trip finished with `clearCredentials()` having run and the refresh
 * writing a live rotation on top of it. Signed out on screen, signed in on
 * disk, and the next launch presents the token and comes back a whole session.
 *
 * Two taps by an ordinary user, and the triggers that start the refresh are the
 * ones that precede it: `wake()` fires on app resume and on network regain, so
 * unlocking the phone or walking back into signal moments before handing a
 * shared tablet over is the ordinary case. It pairs with P1-5(a) — same hand,
 * same end of the same shift.
 */

const ORG = '01J000000000000000000ORG1';

function accessToken(): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: 'u1', orgId: ORG, role: 'owner' }),
  ).toString('base64url');
  return `header.${payload}.signature`;
}

/** A refresh whose answer is held until the test lets it go. */
function heldRefresh(): { release: () => void; posted: () => number } {
  let posts = 0;
  let open!: () => void;
  const held = new Promise<void>((resolve) => {
    open = resolve;
  });

  vi.stubGlobal('fetch', async (input: string): Promise<Response> => {
    const path = new URL(input).pathname;
    if (path === '/auth/logout') return new Response('{}', { status: 200 });
    if (path !== '/auth/refresh') return new Response('{}', { status: 404 });

    posts += 1;
    await held;
    return new Response(
      JSON.stringify({ accessToken: accessToken(), refreshToken: 'rotated-1' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

  return { release: open, posted: () => posts };
}

async function storedRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync('homefarm.refreshToken');
}

beforeEach(async () => {
  await freshStore();
  setApiBase('http://farm.test');
  setAccessToken(null);
  seedSecureStore({
    'homefarm.refreshToken': 'the-stored-token',
    'homefarm.claims': JSON.stringify({ userId: 'u1', orgId: ORG, role: 'owner' }),
  });
});

afterEach(() => {
  resetApiBase();
  setAccessToken(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a sign-out that lands mid-refresh', () => {
  it('leaves no credential behind for the next launch', async () => {
    const server = heldRefresh();

    // Resume or network regain starts the refresh; the tablet is handed over
    // while it is still out.
    const inFlight = refreshSession();
    await signOut();

    server.release();
    const claims = await inFlight;

    expect(server.posted()).toBe(1);
    expect(claims).toBeNull();
    // The half that actually mattered: a rotation written back after the wipe
    // is a working session on the next launch.
    expect(await storedRefreshToken()).toBeNull();
    expect(await readCachedClaims()).toBeNull();
    expect(currentAccessToken()).toBeNull();
  });

  /**
   * The narrower interleaving, and the reason the fence is checked on both
   * sides of the write rather than once before it: `clearCredentials()` can run
   * *while* `setItemAsync` is in flight, and then the delete is overtaken by
   * the write. Whoever finishes last has to tidy.
   */
  it('tidies up when the wipe and the write cross', async () => {
    const server = heldRefresh();
    const real = SecureStore.setItemAsync;
    let signedOut: Promise<void> | null = null;

    vi.spyOn(SecureStore, 'setItemAsync').mockImplementation(
      async (key: string, value: string) => {
        // Sign out from inside the keychain write, so the delete happens while
        // this one is still open and lands first.
        if (key === 'homefarm.refreshToken' && signedOut === null) {
          signedOut = signOut();
          await signedOut;
        }
        await real(key, value);
      },
    );

    const inFlight = refreshSession();
    server.release();

    expect(await inFlight).toBeNull();
    expect(await storedRefreshToken()).toBeNull();
    expect(await readCachedClaims()).toBeNull();
    expect(currentAccessToken()).toBeNull();
  });

  /**
   * Diagnostics exists to tell a deliberate sign-out from a session the server
   * refused, and a 401 arriving after the fact would overwrite the true answer
   * with a misleading one. The credentials are gone either way.
   */
  it('does not blame the server for a session the farmer ended', async () => {
    let open!: () => void;
    const held = new Promise<void>((resolve) => {
      open = resolve;
    });

    vi.stubGlobal('fetch', async (input: string): Promise<Response> => {
      if (new URL(input).pathname === '/auth/logout') return new Response('{}', { status: 200 });
      await held;
      return new Response(JSON.stringify({ error: 'Your session has expired.' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    });

    const inFlight = refreshSession();
    await signOut();
    open();
    await inFlight;

    expect((await localStore().getSessionEnd())?.reason).toBe('signed-out');
  });
});

/**
 * The opposite mistake, and the reason the fence records *what* the transition
 * was rather than merely that there was one.
 *
 * A refresh overtaken by a sign-in must abandon its result — those credentials
 * belong to the session that just ended — but it must not clear anything.
 * Clearing would answer a stale refresh by signing somebody out of the session
 * they had opened a moment earlier, which is a worse fault than the one being
 * fixed.
 */
describe('a sign-in that lands mid-refresh', () => {
  it('keeps the new session and drops the stale one', async () => {
    let releaseRefresh!: () => void;
    const heldRefreshBody = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });

    vi.stubGlobal('fetch', async (input: string): Promise<Response> => {
      const path = new URL(input).pathname;

      if (path === '/auth/refresh') {
        await heldRefreshBody;
        return new Response(
          JSON.stringify({ accessToken: accessToken(), refreshToken: 'stale-rotation' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (path === '/auth/login') {
        return new Response(
          JSON.stringify({ accessToken: accessToken(), refreshToken: 'the-new-session' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      return new Response('{}', { status: 404 });
    });

    const inFlight = refreshSession();
    await signIn('someone@example.com', 'a properly long passphrase');

    releaseRefresh();
    expect(await inFlight).toBeNull();

    expect(await storedRefreshToken()).toBe('the-new-session');
    expect(await readCachedClaims()).not.toBeNull();
  });
});
