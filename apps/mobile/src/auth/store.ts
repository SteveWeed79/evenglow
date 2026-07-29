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
