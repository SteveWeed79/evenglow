import { apiBase, setAccessToken, syncHeaders } from '@steading/core/api';
import type { LocalStore } from '@steading/core/db/port';
import { localStore } from '@steading/core/db/store';
import { z } from 'zod';
import { roleSchema } from '@steading/contracts';
import { discardEmptyLocalOrg, readLocalOrgId, retireLocalOrgId } from './local-org';
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
    /**
     * The farm's own name, sent by sign-in and by every refresh.
     *
     * Not in the access token deliberately — it is not authorization, and a
     * token re-verified on every request is the wrong place for a label. But
     * the client rebuilds its cached claims FROM that token, so anything the
     * cache holds beyond `sub`, `orgId` and `role` must arrive beside it or be
     * carried forward, or it is silently dropped on the first refresh. It was:
     * see `runRefresh`.
     */
    org: z.object({ name: z.string().max(120) }).partial().optional(),
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

  /**
   * Neither name is in the token and neither is authorization.
   *
   * The person's name is the label a note carries, so the other phone can say
   * who wrote it offline. The **farm's** name is what every screen was built to
   * show and never did: `claimFarm` and `googleSignIn` take an `orgName` and
   * send it to the server, and nothing ever put it in the cache — so
   * `useFarmName` has returned null since it was written, and `TodayScreen`'s
   * subtitle has never once rendered. Built, wired at one end only.
   */
  const named: CachedClaims = {
    ...read.claims,
    ...(pair.user?.name === undefined ? {} : { name: pair.user.name }),
    ...(pair.org?.name === undefined ? {} : { orgName: pair.org.name }),
  };

  await writeRefreshToken(pair.refreshToken);
  await writeCachedClaims(named);
  setAccessToken(pair.accessToken);

  // Signed in, so whatever ended the last session is history rather than a
  // fault — cleared for the same reason `syncHeld` is: nothing is wrong now.
  await localStore().recordSessionEnd(null).catch(() => undefined);

  return named;
}

/**
 * The server's own words for why it refused, if it gave any.
 *
 * Best effort by design: a body that is not JSON, or has no `error`, leaves
 * the reason recorded with no detail rather than with a sentence this file
 * made up. Half an answer is worth having; an invented one is not.
 */
async function refusalDetail(res: Response): Promise<{ detail?: string }> {
  const body: unknown = await res.json().catch(() => null);
  const said = (body as { error?: unknown } | null)?.error;
  return typeof said === 'string' ? { detail: said.slice(0, 200) } : {};
}

/** The server's sentence, or a plain one about the network. Never invented. */
async function refusal(res: Response, fallback: string): Promise<SignInError> {
  const body: unknown = await res.json().catch(() => null);
  const said = (body as { error?: unknown })?.error;
  return new SignInError(typeof said === 'string' ? said : fallback);
}

/**
 * Whether the farm currently open has anything in it.
 *
 * Records rather than mutations, which `backup/exposure.ts` sets out at length:
 * a group created and then edited three times is four outbox rows and one
 * record, so counting mutations would call a farm non-empty over an entity
 * somebody thought better of.
 *
 * **Unreadable counts as full.** A farm this cannot measure is a farm nothing
 * may throw away — the whole point of the caller is that it deletes something.
 */
async function localFarmIsEmpty(): Promise<boolean> {
  try {
    return (await localStore().countRecords()) === 0;
  } catch {
    return false;
  }
}

export async function signIn(email: string, password: string): Promise<CachedClaims> {
  /**
   * Asked before the session moves, because afterwards the store belongs to
   * the farm being signed in to and this question is about the other one.
   */
  const wasEmpty = await localFarmIsEmpty();

  const res = await fetch(url('/auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  // The server answers one message for every failure so this route cannot be
  // used to enumerate accounts. Passing it through verbatim keeps that true.
  if (!res.ok) throw await refusal(res, 'That email or password is not right.');

  const claims = await establish(await res.json());

  /**
   * A farm minted on first launch and never written to is not a farm, and
   * leaving the file behind is not free: `discardEmptyLocalOrg` explains what
   * one empty database costs the recovery path, and why a join must not do
   * this even though a sign-in should.
   *
   * Only when the account's farm is a different one. Signing in to the farm
   * this device already holds is the ordinary second-device-of-your-own case,
   * and its database is the one about to be opened.
   */
  if (wasEmpty && claims.orgId !== (await readLocalOrgId())) {
    await discardEmptyLocalOrg();
  }

  return claims;
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
 * no longer the one this device belongs to. `retireLocalOrgId` moves the
 * pointer aside so a later sign-out does not silently reopen it.
 *
 * **Aside, not away.** It used to delete the id, which stranded every record
 * behind it permanently — the file is named for that id and nothing else
 * points at it. The records were never gone; the only copy of their address
 * was. They stay reachable now, from `Get your records out`.
 *
 * The screen says so before the code is sent, with a count, because "anything
 * you logged" is a sentence somebody agrees to without knowing what it costs.
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
  await retireLocalOrgId();
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
let refreshing: Promise<CachedClaims | null> | null = null;

/**
 * Single-flight, and this is a real defect rather than an optimisation.
 *
 * ## Two triggers, one token, and a device signed out
 *
 * `wake()` in `sync/triggers.ts` calls this, and it is wired to TWO listeners
 * — the app becoming active, and the network coming back. On a handset those
 * fire together constantly: unlock the phone in a yard and it regains wifi in
 * the same second as it resumes.
 *
 * Both calls read the SAME refresh token out of secure storage and both post
 * it. The server rotates on use — `consumeRefreshToken` is one conditional
 * update filtered on `usedAt` absent — so the first wins and the second is,
 * correctly and by design, **reuse of a spent token**. Reuse revokes the whole
 * family (`revokeFamily`), which is exactly right when it is a stolen token
 * and catastrophic when it is this app racing itself.
 *
 * The device is then holding a refresh token from a revoked family. Nothing is
 * wrong until the next launch, when the refresh comes back 401, credentials
 * are cleared, and somebody is asked for a password in a barn — having done
 * nothing but open the app twice.
 *
 * Reported as *"the app makes me sign in each time"*, and blamed on the
 * emulator. The emulator only made it reliable: network state flaps on boot,
 * so both triggers land together every run.
 *
 * ## Why sharing the promise is the whole fix
 *
 * Concurrent callers get the same in-flight request and therefore the same
 * rotation. There is no second post, so there is nothing to look like reuse.
 * The server's rule is untouched — it should still revoke a family when a
 * spent token is presented, because the next time that happens it will not be
 * us.
 *
 * The same shape as `pullOnce` and `flushOnce`, which are single-flight for
 * the same class of reason: two passes racing over one piece of state that
 * only moves forward.
 */
export function refreshSession(): Promise<CachedClaims | null> {
  refreshing ??= runRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/**
 * A session-end breadcrumb, which must never be the reason the app will not
 * open.
 *
 * **`localStore()` throws synchronously when no store is installed, so
 * `.catch()` chained onto the call never runs.** Both refusal paths below were
 * written as
 *
 *   await localStore().recordSessionEnd({ … }).catch(() => undefined);
 *
 * which reads as belt-and-braces and is not: the `.catch` is attached to the
 * result of `recordSessionEnd`, and execution never gets that far. The throw
 * escapes `runRefresh`, and `start.ts` awaits this **eighteen lines before it
 * opens the store** — because the database is per-farm and the orgId comes
 * from the session. So the store genuinely is not installed yet on the boot
 * path, and this was fatal there by construction.
 *
 * It shipped because it needs a server that **answers**. An unreachable origin
 * throws in `fetch` and returns cached claims without ever reaching here; only
 * a live server refusing a token gets this far. Pointing a device that had
 * been talking to a laptop at a real deployment does exactly that — the token
 * was signed with the other server's secret — and the app that came up said
 * "Steading could not start. No local store installed", over an intact
 * database, having failed at a diagnostic.
 *
 * The rule this restores is the one stated for the malformed-pair branch
 * further down, in this same function: nothing on the boot path may throw.
 * Losing a breadcrumb is a smaller loss than losing the app, and a device that
 * cannot record why it signed out can still be asked.
 */
async function noteSessionEnd(
  end: Parameters<LocalStore['recordSessionEnd']>[0],
): Promise<void> {
  try {
    await localStore().recordSessionEnd(end);
  } catch {
    // Includes the store not being open yet, which is the ordinary state of
    // the boot path and the whole reason this wrapper exists.
  }
}

async function runRefresh(): Promise<CachedClaims | null> {
  const refreshToken = await readRefreshToken();
  if (refreshToken === null) {
    /**
     * No token at all, which is TWO different situations wearing one silence:
     * a device that has never signed in, and one whose token has gone. The
     * first is the ordinary first run (D14) and the second is a fault.
     *
     * Only recorded when this device has previously held claims — a farm that
     * has never had an account is not a farm that lost one, and marking it
     * would put a fault on the most ordinary state the app has.
     */
    if ((await readCachedClaims()) !== null) {
      await noteSessionEnd({ at: Date.now(), reason: 'no-token' });
    }
    return null;
  }

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

  /**
   * Only a server that actually refuses ends a session.
   *
   * This wiped the credentials on **any** non-2xx, so a 500 or a 502 — a
   * server restarting, a proxy having a moment, a deploy — signed the device
   * out and sent somebody looking for a password in a yard. The offline branch
   * above already gets this right and says why; a 5xx is the same situation
   * with a different shape, because in neither case has anything been decided
   * about this device's right to be signed in.
   *
   * 401 and 403 are the two that mean refused. Everything else keeps the
   * session and lets the next refresh try again.
   */
  if (res.status === 401 || res.status === 403) {
    /**
     * Written down before the credentials go, because afterwards there is
     * nothing left to explain it with.
     *
     * "It makes me sign in again" has been reported four times and diagnosed
     * by inference three of them. Each guess found a real defect — a refresh
     * race, then a rotation stored after the thing that could fail — and each
     * fix was right, and the report came back, because **nothing on the device
     * could tell one cause from another**. A session refused by the server, a
     * token that was never there and a deliberate sign-out all end at the same
     * screen saying the same nothing.
     *
     * The server's own sentence, never one invented here. `detail` is bounded
     * and the token is not in it: this is meant to be screenshotted.
     */
    await noteSessionEnd({
      at: Date.now(),
      reason: 'refused',
      ...(await refusalDetail(res)),
    });

    await clearCredentials();
    setAccessToken(null);
    return null;
  }

  if (!res.ok) return readCachedClaims();

  /**
   * **From here the old refresh token is already spent.**
   *
   * The server rotated the moment it answered 200 and retired what this device
   * sent. So every line below is running with no valid credential on disk until
   * the new one is written, and any path that returns before writing it leaves
   * the device holding a dead token. The next launch presents that token, the
   * server sees a spent one, `revokeFamily` does exactly what it should — and
   * somebody is asked for a password having done nothing but open the app.
   *
   * `establish` states this rule for sign-in: *the refresh token is durable
   * before the access token is live*. This is a second copy of that sequence
   * and it did not follow it — the claim parse came first and returned `null`
   * on failure, before the write. Both reported symptoms fall out of that one
   * ordering: null claims send `start.ts` to `ensureLocalOrgId`, so the app
   * opens the device's own farm instead of the real one, **and** the spent
   * token bricks the next launch for real.
   *
   * So: parse the envelope, store the rotation, and only then worry about
   * whether the access token can be read.
   */
  let pair: z.infer<typeof pairSchema>;
  try {
    pair = pairSchema.parse(await res.json());
  } catch {
    /**
     * A 200 whose body is not a token pair. The rotation is spent and its
     * replacement is unreadable, so this session cannot be saved — but it must
     * not throw either: `start.ts` awaits this on the boot path with no catch,
     * and a rejected promise there is a farm looking at a start-up error over
     * a database that is sitting right beside it, intact.
     *
     * The cached claims keep the right farm open. The next refresh gets the
     * 401 this one could not, and that is where the session properly ends.
     */
    return readCachedClaims();
  }

  await writeRefreshToken(pair.refreshToken);

  const claims = readClaims(pair.accessToken);
  if (claims === null) {
    /**
     * The session is alive on the server — it just handed over a rotation —
     * and this device cannot read the access token that came with it. That is
     * a client-side fault, and answering it by opening a different farm is the
     * worst available response.
     *
     * The cached claims name the right org, so every screen is right and every
     * log is durable. No access token is set, so the flush 401s and the engine
     * keeps the work queued, which is what it does in a barn. Nothing is lost
     * and nothing is wrongly claimed.
     */
    return readCachedClaims();
  }

  /**
   * Everything the cache holds that the access token does not carry.
   *
   * `readClaims` rebuilds from the token, which has `sub`, `orgId` and `role`
   * and nothing else — so every other cached field is dropped here unless it is
   * put back. The display name was already being carried; **the farm's name was
   * not**, so it survived exactly until the first refresh and then vanished for
   * good. That is the next launch, since `start.ts` refreshes at boot.
   *
   * The visible half was "why does no screen show the farm name" — `TodayScreen`
   * has rendered it as a subtitle all along and was reading a field that a farm
   * only ever had for one session.
   *
   * Server first, cache second: a farm that renames itself should see the new
   * name, and `/auth/refresh` now sends it on every rotation for that reason.
   */
  const previous = await readCachedClaims();
  const name = pair.user?.name ?? previous?.name;
  const orgName = pair.org?.name ?? previous?.orgName;

  const named: CachedClaims = {
    ...claims,
    ...(name === undefined ? {} : { name }),
    ...(orgName === undefined ? {} : { orgName }),
  };

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

  // Recorded before the wipe, so Diagnostics can tell a deliberate sign-out
  // from a session the server refused — the distinction the screen exists for.
  await localStore()
    .recordSessionEnd({ at: Date.now(), reason: 'signed-out' })
    .catch(() => undefined);

  // Unconditional, and it swallows nothing: a device that cannot clear its
  // tokens must not report a successful sign-out.
  await clearCredentials();
  setAccessToken(null);
}

export { readCachedClaims };
export type { CachedClaims };

/**
 * What this farm has paid for (D13).
 *
 * Parsed, never trusted — an API response is external data (invariant 11), and
 * this one decides which of two quite different sentences a screen shows.
 */
const billingSchema = z
  .object({
    state: z.string().max(40),
    expiresAt: z.number().int().nullable(),
    syncing: z.boolean(),
    message: z.string().max(200).nullable(),
  })
  .passthrough();

export type BillingState = z.infer<typeof billingSchema>;

/**
 * Asked of the server rather than derived from the sync chip.
 *
 * The chip knows this device was refused; only the server knows what the farm
 * has paid for and until when. Online-only, and the one caller treats a
 * failure as "say nothing" rather than as an error — a barn must not turn a
 * settings screen into a stack trace.
 */
export async function readBilling(): Promise<BillingState> {
  const res = await fetch(url('/billing'), { headers: syncHeaders({}) });
  if (!res.ok) throw new SignInError('Could not reach the farm.');
  return billingSchema.parse(await res.json());
}

/**
 * Redeems a promotion code.
 *
 * Deliberately the same shape as `readBilling` — it returns a `BillingState`,
 * because what a redeemed code produces is a subscription and the screen
 * should not have to learn a second vocabulary for the same fact. The panel
 * that says "Syncing" after a purchase says it after a code, from the same
 * field, having done nothing different.
 *
 * Every refusal is one sentence. The server does not distinguish unknown from
 * spent from expired — telling a guesser they found a real code is most of the
 * work of guessing — and there is exactly one thing to do about any of them,
 * which is ask whoever handed it over.
 */
export async function redeemPromo(code: string): Promise<BillingState> {
  const res = await fetch(url('/billing/promo'), {
    method: 'POST',
    headers: syncHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ code }),
  });

  if (!res.ok) throw new SignInError('That code does not work.');
  return billingSchema.parse(await res.json());
}
