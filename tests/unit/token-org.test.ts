import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessTokenOrg, resetApiBase, setAccessToken, setApiBase } from '@homefarm/core/api';
import { freshStore } from '../support/store';
import { seedSecureStore } from '../support/native/modules';
import { refreshSession, signIn, signOut } from '../../apps/mobile/src/auth/session';

/**
 * The token says which farm it is for, and the sign-in paths are what say so.
 *
 * **The fence in `core/sync/tenant.ts` is only as good as this wiring**, and
 * the wiring is a second argument that a refactor can quietly drop: it
 * defaults to null, and null is *unknown*, so forgetting it does not fail —
 * it silently returns the engine to the state H2 describes, where the bearer
 * token can be one farm's while the open database is another's and nothing on
 * the device can tell. Hence a test on the wiring itself rather than only on
 * the fence it feeds.
 */

const ORG = '01J000000000000000000ORG1';
const OTHER = '01J000000000000000000ORG2';

function accessTokenFor(orgId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: 'u1', orgId, role: 'owner' }),
  ).toString('base64url');
  return `header.${payload}.signature`;
}

/** A server that signs anybody in to `orgId` and rotates to the same. */
function serverFor(orgId: string): void {
  vi.stubGlobal('fetch', async (input: string): Promise<Response> => {
    const path = new URL(input).pathname;
    const body = JSON.stringify({
      accessToken: accessTokenFor(orgId),
      refreshToken: 'rotated-1',
    });

    if (path === '/auth/login' || path === '/auth/refresh') {
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: path === '/auth/logout' ? 200 : 404 });
  });
}

beforeEach(async () => {
  await freshStore();
  setApiBase('http://farm.test');
  setAccessToken(null, null);
  seedSecureStore({
    'homefarm.refreshToken': 'the-stored-token',
    'homefarm.claims': JSON.stringify({ userId: 'u1', orgId: OTHER, role: 'owner' }),
  });
});

afterEach(() => {
  resetApiBase();
  setAccessToken(null, null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the org the access token belongs to', () => {
  it('is recorded when signing in', async () => {
    serverFor(ORG);

    const claims = await signIn('farmer@example.test', 'a properly long passphrase');

    expect(claims.orgId).toBe(ORG);
    expect(accessTokenOrg()).toBe(ORG);
  });

  it('is recorded again on every refresh', async () => {
    serverFor(ORG);
    await signIn('farmer@example.test', 'a properly long passphrase');

    // A rotation is the other place a device acquires a live token, and the
    // one that runs unattended for as long as the app is open.
    setAccessToken(null, null);
    expect(accessTokenOrg()).toBeNull();

    const claims = await refreshSession();

    expect(claims?.orgId).toBe(ORG);
    expect(accessTokenOrg()).toBe(ORG);
  });

  it('is let go with the token on sign-out', async () => {
    serverFor(ORG);
    await signIn('farmer@example.test', 'a properly long passphrase');
    expect(accessTokenOrg()).toBe(ORG);

    await signOut();

    // Not merely tidiness: a stale org left behind would answer the fence's
    // question with a farm this device no longer holds a token for.
    expect(accessTokenOrg()).toBeNull();
  });
});
