import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';
import { roleSchema } from '@steading/contracts';

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

const REFRESH_KEY = 'steading.refreshToken';
const CLAIMS_KEY = 'steading.claims';
const LOCAL_ORG_KEY = 'steading.localOrg';

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

export async function readCachedClaims(): Promise<CachedClaims | null> {
  const raw = await SecureStore.getItemAsync(CLAIMS_KEY);
  if (raw === null) return null;

  try {
    const parsed = cachedClaimsSchema.safeParse(JSON.parse(raw));
    // A shape we do not recognise is discarded rather than repaired. These
    // gate UX only, so the cost of losing them is one render with fewer
    // controls, and the cost of half-trusting them is a screen built on a
    // value nobody validated.
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeCachedClaims(claims: CachedClaims): Promise<void> {
  await SecureStore.setItemAsync(CLAIMS_KEY, JSON.stringify(claims), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
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
}
