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

/**
 * The second half of the same fault, reported the same way — *"it made me sign
 * in again this morning"* — with the screenshot that gave it away: the app had
 * opened a **different farm**, chip reading "On this phone", groups nobody
 * recognised.
 *
 * That is `start.ts` doing exactly what it is told. `refreshSession` returning
 * `null` means "no account on this device", so boot falls through to
 * `ensureLocalOrgId` and opens the org this handset minted for itself. Right
 * answer to the wrong input.
 *
 * The wrong input came from ordering. **A 200 from `/auth/refresh` spends the
 * old token** — the server has rotated and retired it by the time the body is
 * read. `runRefresh` then parsed the access token BEFORE storing the rotation
 * and returned `null` if it could not read it, leaving the device holding a
 * spent credential. The next launch presents it, the server sees reuse,
 * `revokeFamily` fires, and the password prompt arrives.
 *
 * `establish` had the rule written down the whole time: *the refresh token is
 * durable before the access token is live*. This was a second copy of that
 * sequence with the two steps the other way round.
 */
describe('a rotation this device cannot fully read', () => {
  /** Rotates honestly, but hands back an access token that is not a JWT. */
  function unreadableAccessToken(): { posts: string[]; familyRevoked: () => boolean } {
    const spent = new Set<string>();
    const posts: string[] = [];
    let revoked = false;
    let issued = 0;

    vi.stubGlobal('fetch', async (input: string, init?: RequestInit): Promise<Response> => {
      if (new URL(input).pathname !== '/auth/refresh') return new Response('{}', { status: 404 });

      const token = (JSON.parse(String(init?.body ?? '{}')) as { refreshToken?: string })
        .refreshToken ?? '';
      posts.push(token);

      if (revoked || spent.has(token)) {
        revoked = true;
        return new Response(JSON.stringify({ error: 'reused' }), { status: 401 });
      }

      spent.add(token);
      issued += 1;
      return new Response(
        JSON.stringify({ accessToken: 'not-a-jwt', refreshToken: `rotated-${issued}` }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    return { posts, familyRevoked: () => revoked };
  }

  /**
   * The one that opened the wrong farm. Cached claims name the real org, so
   * every screen is right and every log is durable; no access token is set, so
   * the flush 401s and the engine keeps the work queued exactly as it does in
   * a barn. Nothing is lost and nothing is wrongly claimed.
   */
  it('keeps the farm open rather than falling back to the local org', async () => {
    unreadableAccessToken();

    const claims = await refreshSession();

    expect(claims).not.toBeNull();
    expect(claims?.orgId).toBe(ORG);
  });

  /** And the launch after it, which is where the password prompt came from. */
  it('stores the rotation anyway, so the next launch is not reuse', async () => {
    const server = unreadableAccessToken();

    await refreshSession();
    await refreshSession();

    expect(server.posts).toEqual(['the-stored-token', 'rotated-1']);
    expect(server.familyRevoked()).toBe(false);
    expect(await readCachedClaims()).not.toBeNull();
  });

  /**
   * A 200 carrying something that is not a token pair at all. There is no
   * rotation to keep, so this session is finished — but it must not throw:
   * `start.ts` awaits this on the boot path with no catch, and a rejection
   * there is a start-up error over a database sitting right beside it.
   */
  it('does not throw the boot away on a body it cannot parse', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ nothing: 'useful' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(refreshSession()).resolves.not.toBeNull();
  });
});

/**
 * "Should some of the screens show the farm name?"
 *
 * They were built to. `TodayScreen` has rendered it as a subtitle all along,
 * `useFarmName` reads `claims.orgName`, and `claimFarm` and `googleSignIn`
 * both take an `orgName` and send it to the server.
 *
 * **Nothing ever wrote it to the cache.** `establish` built the claims from
 * the access token plus the user's display name and dropped the farm's, so
 * `useFarmName` has returned null since the day it was written and that
 * subtitle has never once appeared. Wired at one end.
 *
 * `runRefresh` had the matching hole: it rebuilds from the token, which
 * carries `sub`, `orgId` and `role` and nothing else, and carried forward only
 * `name` — so even a cache that somehow had `orgName` would lose it on the
 * first refresh, which is the next launch.
 */
describe('the farm’s own name', () => {
  /** As the server sends it now: the pair, and the farm beside it. */
  function serverNaming(name: string | null): void {
    let issued = 0;
    vi.stubGlobal('fetch', async (): Promise<Response> => {
      issued += 1;
      return new Response(
        JSON.stringify({
          accessToken: accessToken(),
          refreshToken: `rotated-${issued}`,
          ...(name === null ? {} : { org: { name } }),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
  }

  it('survives the refresh that used to drop it', async () => {
    serverNaming('Weed Family Farm');

    await refreshSession();
    expect((await readCachedClaims())?.orgName).toBe('Weed Family Farm');
  });

  /**
   * The device that has one cached and a server too old to send it. Keeping it
   * is right — the farm has not been renamed, this response simply did not
   * mention it — and it is the case that made the bug invisible for so long.
   */
  it('is carried forward when the response does not repeat it', async () => {
    seedSecureStore({
      'steading.refreshToken': 'the-stored-token',
      'steading.claims': JSON.stringify({
        userId: 'u1',
        orgId: ORG,
        role: 'owner',
        orgName: 'Weed Family Farm',
      }),
    });
    serverNaming(null);

    await refreshSession();
    expect((await readCachedClaims())?.orgName).toBe('Weed Family Farm');
  });

  /** A rename reaches every device on its next rotation, not on its next sign-in. */
  it('takes the server’s name over the cached one', async () => {
    seedSecureStore({
      'steading.refreshToken': 'the-stored-token',
      'steading.claims': JSON.stringify({
        userId: 'u1',
        orgId: ORG,
        role: 'owner',
        orgName: 'The old name',
      }),
    });
    serverNaming('Weed Family Farm');

    await refreshSession();
    expect((await readCachedClaims())?.orgName).toBe('Weed Family Farm');
  });
});
