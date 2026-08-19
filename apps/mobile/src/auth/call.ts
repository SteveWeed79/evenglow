import { apiBase, currentAccessToken } from '@homefarm/core/api';
import { refreshSession } from './session';

/**
 * An authenticated call to the farm server, for the few screens that make one.
 *
 * Almost nothing in this app does. Every screen renders the local SQLite
 * projection and the sync engine does the talking, which is the whole premise —
 * so this exists for the handful of things that are **not** farm records:
 * membership, invitations, join codes, the org's own name. None of those are
 * syncable entities, none goes through the mutation queue, and all of them need
 * a bearer token in the moment.
 *
 * Here rather than inside a screen because a second screen now needs it, and
 * the token dance below is not something to have two copies of.
 */
export async function call(
  path: string,
  init: { method?: string; body?: unknown } = {},
  /**
   * What the caller was trying to do, for the signed-out sentence.
   *
   * "Sign in again to rename the farm" beats a generic refusal, and the caller
   * is the only thing that knows which it is.
   */
  whatFor = 'change anything on the farm server',
): Promise<unknown> {
  const base = apiBase();
  if (base === null) throw new Error('This build has no farm server configured.');

  /**
   * No token yet? Get one, rather than telling somebody to wait for something
   * that was never going to happen.
   *
   * The access token is held in memory only (see `core/api` for why) and is
   * minted by `refreshSession` — at boot, on resume, and on network regain. A
   * boot that happened before the network was up takes the offline path, which
   * correctly keeps the session but leaves the token null for the rest of the
   * process.
   *
   * That left the members screen permanently stuck, and the recovery it offered
   * could not work: "Try again" re-ran the fetch with the same absent token, so
   * the button was decoration and "in a moment" never came. Nothing else in the
   * app shows the difference, because every other screen renders the local
   * projection and never needs a header.
   */
  let token = currentAccessToken();
  if (token === null) {
    // Refuses only on a server that actually rejects the refresh token, in
    // which case it has already cleared this device — so a null return here
    // means signed out, not offline.
    const renewed = await refreshSession();
    token = currentAccessToken();

    if (token === null) {
      throw new Error(
        renewed === null
          ? `This device is signed out. Sign in again to ${whatFor}.`
          : 'The farm server could not be reached to renew this session.',
      );
    }
  }

  const res = await fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  if (res.status === 204) return null;

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { error?: unknown })?.error;
    // The server names its refusals — "A farm needs at least one owner" — and
    // passing them through verbatim is what makes them useful.
    throw new Error(typeof message === 'string' ? message : 'The farm server refused that.');
  }
  return body;
}
