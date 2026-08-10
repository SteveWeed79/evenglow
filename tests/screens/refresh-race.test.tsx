import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiBase, setAccessToken, setApiBase } from '@steading/core/api';
import { freshStore } from '../support/store';
import { seedSecureStore } from '../support/native/modules';
import { readCachedClaims, refreshSession } from '../../apps/mobile/src/auth/session';

/**
 * "The app makes me sign in each time."
 *
 * Reported from an emulator and blamed on the emulator. It was not.
 *
 * `wake()` in `sync/triggers.ts` refreshes the session, and it is wired to TWO
 * listeners — the app becoming active and the network coming back. On a
 * handset those fire together constantly: unlock a phone in a yard and it
 * regains wifi in the same second it resumes. The emulator only made it
 * reliable, because network state flaps on boot.
 *
 * Both calls read the same refresh token and both post it. The server rotates
 * on use, so the first wins and the second is — correctly, by design — reuse
 * of a spent token, which revokes the whole family. That rule is right: it is
 * how a stolen token is caught. It is catastrophic when the app is racing
 * itself.
 *
 * Nothing looks wrong until the next launch, when the refresh comes back 401,
 * the credentials are cleared, and somebody is asked for a password in a barn
 * having done nothing but open the app twice.
 */

const ORG = '01J000000000000000000ORG1';

function accessToken(): string {
  const payload = Buffer.from(JSON.stringify({ sub: 'u1', orgId: ORG, role: 'owner' })).toString(
    'base64url',
  );
  return `header.${payload}.signature`;
}

/**
 * A server that rotates like the real one: a refresh token may be spent once,
 * and presenting a spent one revokes the family.
 */
function rotatingServer(): { posts: string[]; familyRevoked: () => boolean } {
  const spent = new Set<string>();
  const posts: string[] = [];
  let revoked = false;
  let issued = 0;

  vi.stubGlobal('fetch', async (input: string, init?: RequestInit): Promise<Response> => {
    const path = new URL(input).pathname;
    if (path !== '/auth/refresh') return new Response('{}', { status: 404 });

    const sent = JSON.parse(String(init?.body ?? '{}')) as { refreshToken?: string };
    const token = sent.refreshToken ?? '';
    posts.push(token);

    if (revoked || spent.has(token)) {
      // Reuse of a spent token. The server revokes the whole family, and every
      // later refresh — including the honest one on the next launch — is 401.
      revoked = true;
      return new Response(JSON.stringify({ error: 'reused' }), { status: 401 });
    }

    spent.add(token);
    issued += 1;
    return new Response(
      JSON.stringify({ accessToken: accessToken(), refreshToken: `rotated-${issued}` }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

  return { posts, familyRevoked: () => revoked };
}

beforeEach(async () => {
  await freshStore();
  setApiBase('http://farm.test');
  setAccessToken(null);
  seedSecureStore({
    'steading.refreshToken': 'the-stored-token',
    'steading.claims': JSON.stringify({ userId: 'u1', orgId: ORG, role: 'owner' }),
  });
});

afterEach(() => {
  resetApiBase();
  setAccessToken(null);
  vi.unstubAllGlobals();
});

describe('two triggers waking at once', () => {
  it('spends the refresh token exactly once', async () => {
    const server = rotatingServer();

    // Resume and network-regain, in the same tick. This is the ordinary case
    // on a handset, not a contrived one.
    const [a, b] = await Promise.all([refreshSession(), refreshSession()]);

    expect(server.posts).toHaveLength(1);
    expect(server.familyRevoked()).toBe(false);
    // Both callers get the same answer, because they shared the same request.
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
  });

  it('leaves the device signed in for the next launch', async () => {
    const server = rotatingServer();

    await Promise.all([refreshSession(), refreshSession(), refreshSession()]);

    // The launch after the race: the token the device now holds must still
    // work. Before the fix this was the 401 that asked for a password.
    const next = await refreshSession();

    expect(next).not.toBeNull();
    expect(server.familyRevoked()).toBe(false);
    expect(await readCachedClaims()).not.toBeNull();
  });

  it('still refreshes again once the first has finished', async () => {
    const server = rotatingServer();

    await refreshSession();
    await refreshSession();

    // Single-flight, not once-ever: a later resume is a real refresh.
    expect(server.posts).toHaveLength(2);
    expect(server.familyRevoked()).toBe(false);
  });
});
