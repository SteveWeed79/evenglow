import { apiBase, setAccessToken } from '@steading/core/api';
import { z } from 'zod';
import { roleSchema } from '@steading/contracts';
import { forgetLocalOrgId } from './local-org';
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
export type ClaimsRead =
  | { ok: true; claims: CachedClaims }
  | { ok: false; problem: string };

/**
 * The same read, but it says what went wrong.
 *
 * "The server sent a session we could not read" was true and unactionable: a
 * missing claim, an unreadable payload and a token that is not a token all
 * produced one sentence, so the same screenshot fitted a wrong field name, a
 * missing `atob`, and simply running yesterday's bundle. Naming the field
 * turns three indistinguishable failures into three different sentences.
 *
 * Nothing sensitive is named. These are field names in a token this device was
 * just handed, not its values.
 */
export function parseClaims(accessToken: string): ClaimsRead {
  const payload = accessToken.split('.')[1];
  if (payload === undefined) return { ok: false, problem: 'it is not shaped like a token' };

  let json: unknown;
  try {
    json = JSON.parse(decodeBase64Url(payload));
  } catch {
    return { ok: false, problem: 'its middle section is not readable' };
  }

  const parsed = claimsSchema.safeParse(json);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || 'it'))];
    return { ok: false, problem: `it has no usable ${fields.join(' or ')}` };
  }

  return { ok: true, claims: parsed.data };
}

export function readClaims(accessToken: string): CachedClaims | null {
  const read = parseClaims(accessToken);
  return read.ok ? read.claims : null;
}

export class SignInError extends Error {}

/**
 * Turns a token pair into a signed-in device.
 *
 * Shared by every route that ends in a session — sign-in, claiming a farm,
 * redeeming a join code — because the *order* here is load-bearing and three
 * copies of it would be three chances to get it wrong: the refresh token is
 * durable before the access token is live, so a crash mid-way leaves a device
 * that can recover a session rather than one holding a credential it cannot
 * renew.
 */
async function establish(body: unknown): Promise<CachedClaims> {
  const pair = pairSchema.parse(body);
  const read = parseClaims(pair.accessToken);
  if (!read.ok) {
    throw new SignInError(`The server sent a session we could not read — ${read.problem}.`);
  }

  // The name is not in the token and is not authorization — it is the label a
  // note carries so the other person's phone can say who wrote it offline.
  const named: CachedClaims =
    pair.user?.name === undefined ? read.claims : { ...read.claims, name: pair.user.name };

  await writeRefreshToken(pair.refreshToken);
  await writeCachedClaims(named);
  setAccessToken(pair.accessToken);

  return named;
}

/** The server's sentence, or a plain one about the network. Never invented. */
async function refusal(res: Response, fallback: string): Promise<SignInError> {
  const body: unknown = await res.json().catch(() => null);
  const said = (body as { error?: unknown })?.error;
  return new SignInError(typeof said === 'string' ? said : fallback);
}

export async function signIn(email: string, password: string): Promise<CachedClaims> {
  const res = await fetch(url('/auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  // The server answers one message for every failure so this route cannot be
  // used to enumerate accounts. Passing it through verbatim keeps that true.
  if (!res.ok) throw await refusal(res, 'That email or password is not right.');

  return establish(await res.json());
}

/**
 * Claims the farm this device has been keeping (A2.2).
 *
 * **The orgId goes up with the request, and it is the one this device already
 * has.** The server adopts it rather than assigning one, so nothing local
 * moves: same database file, same rows, same entity ids. The queue that has
 * been accumulating since first launch simply starts to flush.
 *
 * Called with the id from `ensureLocalOrgId`, which is also the id the store
 * is already open on — see `Boot.onSignedIn` for why that makes the reopen a
 * no-op rather than a migration.
 */
export async function claimFarm(input: {
  orgId: string;
  orgName: string;
  name: string;
  email: string;
  password: string;
}): Promise<CachedClaims> {
  const res = await fetch(url('/auth/signup'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!res.ok) throw await refusal(res, 'Could not set up the account. Try again.');

  return establish(await res.json());
}

/**
 * Signs in — or signs up — with a Google ID token (A2.4).
 *
 * **One call for both, because the device cannot know which it is doing.**
 * Whether an address already has an account is exactly the question a sign-in
 * screen must not be able to ask, so the server decides: a known Google
 * account signs in, a known email gets the Google identity bound to it, and
 * neither claims the farm this device is holding.
 *
 * The org is sent for the same reason `claimFarm` sends it — if this turns out
 * to be a signup, it must adopt the records already on the handset rather than
 * open an empty farm beside them.
 */
export async function googleSignIn(input: {
  idToken: string;
  orgId: string;
  orgName: string;
}): Promise<CachedClaims> {
  const res = await fetch(url('/auth/google'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!res.ok) throw await refusal(res, 'That Google sign-in did not work. Try again.');

  return establish(await res.json());
}

/**
 * Joins somebody else's farm with a code they are holding out (A2.5).
 *
 * **This device's own farm is left behind, deliberately.** A hand joining an
 * employer's farm gets that farm's database, and the org this handset minted
 * on first launch — with whatever was logged before the code was typed — is
 * no longer reachable. `forgetLocalOrgId` is what makes that final rather than
 * something a later sign-out would silently reopen.
 *
 * The screen says so before the code is sent. It is the honest cost of a
 * one-org-per-user model, and hiding it would mean somebody discovering it on
 * the morning they went looking for last week's tallies.
 */
export async function joinFarm(input: {
  code: string;
  name: string;
  email: string;
  password: string;
}): Promise<CachedClaims> {
  const res = await fetch(url('/join-codes/redeem'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!res.ok) throw await refusal(res, 'That code did not work. Ask for a fresh one.');

  const claims = await establish(await res.json());
  await forgetLocalOrgId();
  return claims;
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
