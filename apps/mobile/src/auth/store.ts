import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';
import { roleSchema } from '@homefarm/contracts';

/**
 * Token storage, and the only file that names `expo-secure-store`.
 *
 * Invariant 6 has wanted this since S3b: **tokens live in secure storage,
 * never in SQLite and never in web storage.** On Android that is the Keystore,
 * which means the refresh token is encrypted at rest by hardware the app does
 * not own and cannot be read by another app or by anyone holding the database
 * file.
 *
 * ## What is stored, and what deliberately is not
 *
 * The **refresh token** is stored, because it has to survive a cold start —
 * a farmer who signs in on Monday must not be signed out on Tuesday.
 *
 * The **access token is not.** It is short-lived and is minted from the
 * refresh token at every launch, so storing it would add a second live
 * credential on disk to save one request. It lives in memory, in `api.ts`.
 *
 * **Cached claims** are stored, and they are UX only (invariant 8). They let
 * the app draw the right controls before the network answers; they are never
 * authorization. The server re-derives identity, org and role from the
 * database on every mutation, and a hand who edited this file to say `owner`
 * would get a 403 on the first write.
 */

const REFRESH_KEY = 'homefarm.refreshToken';
const CLAIMS_KEY = 'homefarm.claims';
const LOCAL_ORG_KEY = 'homefarm.localOrg';

/**
 * Farms this device minted and then moved away from.
 *
 * **The id is the only pointer to a farm's database** — the file is
 * `homefarm-{orgId}.db` and nothing else names it — so deleting the id on a
 * join stranded every record behind it permanently, with no error and nothing
 * on any screen. The active pointer still has to move, or signing out would
 * reopen the wrong farm; what it must not do is go in the bin.
 */
const RETIRED_ORGS_KEY = 'homefarm.retiredOrgs';

/**
 * Parsed on read, never trusted (invariant 11).
 *
 * Secure storage is external data: it survives app upgrades, so a value
 * written by an older version with a different shape is a real case rather
 * than a hypothetical one.
 */
const cachedClaimsSchema = z
  .object({
    userId: z.string().min(1).max(64),
    orgId: z.string().min(1).max(64),
    role: roleSchema,
    name: z.string().max(80).optional(),
    orgName: z.string().max(120).optional(),
    /**
     * The address this account signs in with, and whether it has been proved.
     *
     * **Cached because the app never had it and now has to show it.** A farmer
     * cannot notice they typed `alcie@` instead of `alice@` on a screen that
     * does not display what was typed, and a bare "unconfirmed" flag would be a
     * warning nobody can act on. `AccountScreen` renders both.
     *
     * Optional on both, and not only for old cache rows: a server that predates
     * verification sends neither, and the right reading of silence is "this
     * device does not know" — never "unconfirmed", which would put a warning on
     * a screen over a server that has no opinion.
     */
    email: z.string().max(254).optional(),
    emailVerified: z.boolean().optional(),
    /**
     * Whether a Google identity is bound to this account.
     *
     * What it is for is the account screen saying which sign-ins work, rather
     * than offering to connect a Google account to one that already has one.
     *
     * Optional for the same reason as the two above, and the reading of absent
     * is the same: *this device has not been told*. A server that predates the
     * link route sends nothing, and rendering that as "not connected" would
     * offer a control whose answer is already known — which is how a farmer
     * ends up tapping something that cannot work.
     *
     * The Google subject itself is deliberately not here. A screen needs to
     * know that there is one; the identifier is Google's, nothing on the
     * handset has a use for it, and a cache is a poor place for an identity.
     */
    googleLinked: z.boolean().optional(),
  })
  .strict();

export type CachedClaims = z.infer<typeof cachedClaimsSchema>;

export async function readRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export async function writeRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_KEY, token, {
    // Available after first unlock rather than while unlocked: the sync loop
    // runs on resume and on network regain, and a token the app cannot read
    // with the screen off would turn every background flush into a sign-out.
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

/**
 * Who this device is, as something a screen can watch.
 *
 * ## Why a subscription and not another read
 *
 * Every screen that cared read `readCachedClaims()` once in a mount effect and
 * kept the answer. That is correct for signing *in* — the tree remounts — and
 * wrong for signing out, which changes the value under screens that are already
 * standing. Reported from the phone: *"the sign out button never changes from
 * sign out, even when the account is signed out. It doesn't look like anything
 * changes on the app until after it is restarted."*
 *
 * Both halves of that are this: the button, and the farm's name, and the
 * account row, all reading a value that nothing told them had changed. It only
 * came right on restart because `clearCredentials` really had removed it — the
 * storage was right the whole time and the screens were stale.
 *
 * ## Here rather than in a hook
 *
 * This module is the one that owns the value, so publishing from the two
 * functions that change it means **nothing can change claims without saying
 * so**. A notifier a caller has to remember is a notifier somebody forgets on
 * the third sign-in path, and there are five.
 *
 * Still UX only (invariant 8). This makes a cached claim *timely*; it does not
 * make it authorization, and the server re-derives identity on every mutation
 * exactly as before.
 */
let snapshot: CachedClaims | null | undefined;
const listeners = new Set<() => void>();

/**
 * Publishes, but only when the answer actually changed.
 *
 * Every read publishes what it found, and screens re-read on mount, so without
 * this a value that had not moved would still hand out a fresh object and wake
 * every subscriber on every navigation. `useSyncExternalStore` compares by
 * reference — an equal-but-new object is a change as far as it is concerned.
 *
 * Compared by content rather than by identity for the same reason: the object
 * is rebuilt by `JSON.parse` on every read, so it is never the same one twice.
 */
function publishClaims(next: CachedClaims | null): void {
  const settled = snapshot !== undefined;
  if (settled && JSON.stringify(snapshot) === JSON.stringify(next)) return;

  snapshot = next;
  for (const listener of listeners) listener();
}

/**
 * `undefined` until something has read, `null` once it has read and there is
 * nobody. The two are different sentences and a screen says a different thing
 * for each — the same distinction `readNumbers` draws between no last year and
 * nothing last year.
 */
export function claimsSnapshot(): CachedClaims | null | undefined {
  return snapshot;
}

export function subscribeToClaims(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export async function readCachedClaims(): Promise<CachedClaims | null> {
  const raw = await SecureStore.getItemAsync(CLAIMS_KEY);
  if (raw === null) {
    publishClaims(null);
    return null;
  }

  try {
    const parsed = cachedClaimsSchema.safeParse(JSON.parse(raw));
    // A shape we do not recognise is discarded rather than repaired. These
    // gate UX only, so the cost of losing them is one render with fewer
    // controls, and the cost of half-trusting them is a screen built on a
    // value nobody validated.
    const claims = parsed.success ? parsed.data : null;
    publishClaims(claims);
    return claims;
  } catch {
    publishClaims(null);
    return null;
  }
}

export async function writeCachedClaims(claims: CachedClaims): Promise<void> {
  await SecureStore.setItemAsync(CLAIMS_KEY, JSON.stringify(claims), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
  // After the write, so a screen woken by this cannot read back a value that
  // is not on disk yet.
  publishClaims(claims);
}

/**
 * The farm id a device holds before it has an account (A2.1).
 *
 * Not a credential, and it is here anyway — because invariant 6 permits
 * exactly two stores on a handset, SQLite and this one, and this value is the
 * **key to which SQLite file to open**. It cannot live in the database it
 * names. This module is also the only file the lint guard lets name secure
 * storage, so the raw read and write belong here and the policy on top of them
 * lives in `local-org.ts`.
 *
 * Deliberately NOT cleared by `clearCredentials`: signing out of a farm must
 * leave its records reachable, and the id is how they are reached.
 */
export async function readLocalOrgRaw(): Promise<string | null> {
  return SecureStore.getItemAsync(LOCAL_ORG_KEY);
}

export async function writeLocalOrg(orgId: string): Promise<void> {
  await SecureStore.setItemAsync(LOCAL_ORG_KEY, orgId, {
    // The same reasoning as the refresh token: the sync loop runs on resume
    // and on network regain, and a value the app cannot read with the screen
    // off would make a background flush open the wrong database — or none.
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

export async function clearLocalOrg(): Promise<void> {
  await SecureStore.deleteItemAsync(LOCAL_ORG_KEY).catch(() => undefined);
}

/** Raw, parsed by `local-org.ts` — nothing here trusts what it reads. */
export async function readRetiredOrgsRaw(): Promise<string | null> {
  return SecureStore.getItemAsync(RETIRED_ORGS_KEY);
}

export async function writeRetiredOrgs(orgIds: readonly string[]): Promise<void> {
  await SecureStore.setItemAsync(RETIRED_ORGS_KEY, JSON.stringify(orgIds), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

/**
 * Wipes every credential this device holds.
 *
 * Called on sign-out and on a refresh that the server refused. Deletion is
 * unconditional and swallows its own errors: a device that cannot clear a
 * token must still end the session, and throwing here would leave someone
 * signed in because the wipe failed.
 */
export async function clearCredentials(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => undefined),
    SecureStore.deleteItemAsync(CLAIMS_KEY).catch(() => undefined),
  ]);
  // The half the sign-out report was actually about. Everything already on
  // screen holds the old claims until it is told, and until this line nothing
  // ever told it.
  publishClaims(null);
}
