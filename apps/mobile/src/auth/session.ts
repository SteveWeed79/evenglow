import { apiBase, setAccessToken } from '@steading/core/api';
import { z } from 'zod';
import { roleSchema } from '@steading/contracts';
import {
  type CachedClaims,
  clearCredentials,
  readCachedClaims,
  readRefreshToken,
  writeCachedClaims,
  writeRefreshToken,
} from './store';

/**
 * The session: signing in, staying signed in, and signing out.
 *
 * Deliberately not part of the sync engine. The engine's job is to report that
 * a batch was refused as `unauthenticated`; deciding whether that means
 * "refresh" or "sign in again" is a session question, and threading it into
 * flush would put a credential concern inside the one loop that must stay
 * about mutations.
 */

const pairSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    /**
     * Sign-in hands over the display name once.
     *
     * Optional because refresh does not repeat it and an older server does not
     * send it at all — in both cases the previously cached name is carried
     * forward rather than being lost.
     */
    user: z.object({ name: z.string().max(80) }).partial().optional(),
  })
  .passthrough();

/**
 * Parsed, never trusted — an API response is external data (invariant 11).
 *
 * **`sub`, not `userId`.** `mintAccessToken` puts the user id in the standard
 * subject claim with `.setSubject()`, and the server's own `verifyAccessToken`
 * maps it back the same way. This schema asked for a `userId` field that no
 * token has ever carried, so every sign-in reached a valid session and then
 * discarded it — "The server sent a session we could not read", on a correct
 * email and password.
 *
 * Nothing caught it because both halves were tested against themselves: the
 * server round-trips its own tokens, and the client's tests built claim
 * objects by hand. `tests/unit/token-shape.test.ts` now mints with the
 * server's signer and reads with this, which is the only arrangement that
 * could have failed.
 */
const claimsSchema = z
  .object({
    sub: z.string().min(1),
    orgId: z.string().min(1),
    role: roleSchema,
  })
  .transform(({ sub, orgId, role }): CachedClaims => ({ userId: sub, orgId, role }));

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64url → string, without `atob`.
 *
 * `atob` is a global React Native happens to provide, and a global whose
 * presence cannot be checked from here is a poor thing to put under the one
 * path that gates every screen in the app. Twelve lines that run on any engine
 * are worth more than a comment asserting the global is there — especially
 * since a missing `atob` and a wrong claim name fail identically, which is
 * exactly the ambiguity that made the bug above hard to place.
 *
 * Padding is not required: JWT strips it, and this stops at the end of the
 * input rather than demanding a multiple of four.
 */
export function decodeBase64Url(input: string): string {
  let accumulator = 0;
  let bits = 0;
  let out = '';

  for (const character of input) {
    if (character === '=') break;
    const value = BASE64.indexOf(
      character === '-' ? '+' : character === '_' ? '/' : character,
    );
    if (value === -1) throw new Error('Not base64url.');

    accumulator = (accumulator << 6) | value;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((accumulator >> bits) & 0xff);
    }
  }

  return out;
}

function url(path: string): string {
  const base = apiBase();
  if (base === null) throw new Error('No API base configured.');
  return `${base}${path}`;
}

/**
 * Decodes the access token's payload for the claims to cache.
 *
 * **This is not verification.** The signature is not checked and could not
 * usefully be — the client does not hold the secret, and if it did, the secret
 * would be in an APK. The server verifies on every request; this only reads
 * what it was told so the UI can draw the right controls before the first
 * response arrives (invariant 8).
 */
export function readClaims(accessToken: string): CachedClaims | null {
  const payload = accessToken.split('.')[1];
  if (payload === undefined) return null;

  try {
    const json: unknown = JSON.parse(decodeBase64Url(payload));
    const parsed = claimsSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export class SignInError extends Error {}

export async function signIn(email: string, password: string): Promise<CachedClaims> {
  const res = await fetch(url('/auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    // The server answers one message for every failure so this route cannot be
    // used to enumerate accounts. Passing it through verbatim keeps that true.
    const body: unknown = await res.json().catch(() => null);
    const message =
      typeof (body as { error?: unknown })?.error === 'string'
        ? (body as { error: string }).error
        : 'That email or password is not right.';
    throw new SignInError(message);
  }

  const pair = pairSchema.parse(await res.json());
  const claims = readClaims(pair.accessToken);
  if (claims === null) throw new SignInError('The server sent a session we could not read.');

  // The name is not in the token and is not authorization — it is the label a
  // note carries so the other person's phone can say who wrote it offline.
  const named: CachedClaims =
    pair.user?.name === undefined ? claims : { ...claims, name: pair.user.name };

  await writeRefreshToken(pair.refreshToken);
  await writeCachedClaims(named);
  setAccessToken(pair.accessToken);

  return named;
}

/**
 * Exchanges the stored refresh token for a fresh access token.
 *
 * Returns null when there is nothing to exchange or the server refuses, and
 * **wipes the device in the second case**. A refresh token the server has
 * rejected is either expired or revoked; keeping it would mean retrying a
 * dead credential on every resume forever, and on a stolen handset it would
 * mean keeping a credential the owner has already revoked.
 */
export async function refreshSession(): Promise<CachedClaims | null> {
  const refreshToken = await readRefreshToken();
  if (refreshToken === null) return null;

  let res: Response;
  try {
    res = await fetch(url('/auth/refresh'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    /**
     * Offline. Emphatically NOT a sign-out.
     *
     * A farmer opening the app in a barn with no signal must stay signed in
     * and keep logging — that is the entire premise. Only a server that
     * actually refuses ends a session.
     */
    return readCachedClaims();
  }

  if (!res.ok) {
    await clearCredentials();
    setAccessToken(null);
    return null;
  }

  const pair = pairSchema.parse(await res.json());
  const claims = readClaims(pair.accessToken);
  if (claims === null) return null;

  // Refresh does not repeat the display name, so it is carried forward rather
  // than being quietly dropped on the first resume after a sign-in.
  const previous = await readCachedClaims();
  const name = pair.user?.name ?? previous?.name;
  const named: CachedClaims = name === undefined ? claims : { ...claims, name };

  // Rotation: the server issues a new refresh token and retires the old one,
  // so failing to store this would sign the device out on the next launch.
  await writeRefreshToken(pair.refreshToken);
  await writeCachedClaims(named);
  setAccessToken(pair.accessToken);

  return named;
}

/**
 * Ends the session. Clears credentials, and deliberately leaves the data.
 *
 * **This is a correction to the obvious design, and the reasoning matters.**
 * The first version wiped the local database on sign-out, on the shared-tablet
 * argument: the next person must not find the previous farm's animals.
 *
 * Two things make that wrong here.
 *
 * The database is **per farm** (`db/open.ts`), so a different farm signing in
 * on the same tablet opens a different file. The isolation is structural and
 * does not depend on a wipe having run. Wiping adds nothing against the case
 * it was aimed at.
 *
 * And the wipe destroys **unsent work**. A hand who finishes a shift in a barn
 * with no signal and signs out has a queue, and that queue is the entire point
 * of the app. Trading it for isolation that is already guaranteed is the worst
 * bargain in the codebase.
 *
 * What OWASP MASVS-STORAGE actually requires on logout is that the *tokens*
 * go, and they do — unconditionally, and before anything that can throw.
 * Deleting the records is a separate, explicit action: `forgetDatabase`, for
 * when the tablet really is being handed on.
 *
 * The server call is best-effort. A device with no signal must still be able
 * to sign out.
 */
export async function signOut(): Promise<void> {
  const refreshToken = await readRefreshToken();

  if (refreshToken !== null) {
    await fetch(url('/auth/logout'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }

  // Unconditional, and it swallows nothing: a device that cannot clear its
  // tokens must not report a successful sign-out.
  await clearCredentials();
  setAccessToken(null);
}

export { readCachedClaims };
export type { CachedClaims };
