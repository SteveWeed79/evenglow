import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiBase, setAccessToken, setApiBase } from '@homefarm/core/api';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { seedSecureStore } from '../support/native/modules';
import { MembersScreen } from '../../apps/mobile/src/screens/MembersScreen';

/**
 * "Who is on this farm" said the session had not been refreshed yet, and the
 * Try again button under that sentence could not ever fix it.
 *
 * The access token is held in memory only and is minted by `refreshSession` —
 * at boot, on resume, and on network regain. A boot that happened before the
 * network was up takes the offline path, which correctly keeps the session but
 * leaves the token null for the rest of the process. `Try again` re-ran the
 * members fetch with the same absent token, so it was decoration and "in a
 * moment" never came.
 *
 * This is the only screen in the app that needs a token — every other one
 * renders the local projection — which is why nothing else showed it.
 */

const ORG = '01J000000000000000000ORG1';

/** A token shaped the way the server's `mintAccessToken` shapes one. */
function accessToken(role = 'owner'): string {
  const payload = Buffer.from(JSON.stringify({ sub: 'u1', orgId: ORG, role })).toString(
    'base64url',
  );
  return `header.${payload}.signature`;
}

beforeEach(async () => {
  await freshStore();
  setApiBase('http://farm.test');

  // The state the device was in: signed in, with no access token in memory.
  setAccessToken(null);
  seedSecureStore({
    'homefarm.refreshToken': 'a-stored-refresh-token',
    'homefarm.claims': JSON.stringify({ userId: 'u1', orgId: ORG, role: 'owner' }),
  });
});

afterEach(() => {
  resetApiBase();
  setAccessToken(null);
  vi.unstubAllGlobals();
});

/** Answers the two routes this screen reaches, and counts what was asked. */
function server(options: { refreshOk?: boolean } = {}): { paths: string[] } {
  const paths: string[] = [];

  vi.stubGlobal('fetch', async (input: string): Promise<Response> => {
    const path = new URL(input).pathname;
    paths.push(path);

    if (path === '/auth/refresh') {
      if (options.refreshOk === false) {
        return new Response(JSON.stringify({ error: 'no' }), { status: 401 });
      }
      return new Response(
        JSON.stringify({ accessToken: accessToken(), refreshToken: 'a-rotated-one' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    if (path === '/members') {
      return new Response(
        JSON.stringify({
          members: [
            { id: 'u1', name: 'Sam', email: 'sam@farm.test', role: 'owner', disabled: false },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify({ invites: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  return { paths };
}

describe('a session whose access token was never minted', () => {
  it('asks for one rather than reporting that it has none', async () => {
    const farm = server();

    const screen = await mount(<MembersScreen />);

    // The refresh happened, and it happened before the members call — which is
    // the whole fix. Previously only `/members` was ever attempted, with no
    // authorization header, and the screen reported its own missing token.
    expect(farm.paths[0]).toBe('/auth/refresh');
    expect(farm.paths).toContain('/members');
    expect(screen.text()).not.toContain('Could not reach the farm');
    screen.unmount();
  });

  it('shows who is on the farm, which is what the screen is for', async () => {
    server();

    const screen = await mount(<MembersScreen />);

    expect(screen.text()).toContain('sam@farm.test');
    screen.unmount();
  });

  /**
   * A refresh token the server refuses means this device is signed out — that
   * is `refreshSession`'s documented behaviour, and it has already cleared the
   * credentials by the time it returns null. Saying "try again in a moment"
   * to somebody who needs to sign in is the same unactionable sentence in a
   * different disguise.
   */
  it('says signed out when the server refuses the refresh, not "in a moment"', async () => {
    server({ refreshOk: false });

    const screen = await mount(<MembersScreen />);

    expect(screen.text()).toContain('signed out');
    expect(screen.text()).not.toContain('in a moment');
    screen.unmount();
  });
});
