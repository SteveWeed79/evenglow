import { SignJWT, importPKCS8 } from 'jose';
import { z } from 'zod';
import type { Subscription, SubscriptionState } from '@homefarm/contracts';
import { HttpError } from '../http';

/**
 * Google Play as a rail, behind a seam (D13).
 *
 * The rules about what a subscription *buys* live in
 * `@homefarm/contracts/billing` and are pure. This file is the adapter that
 * turns what Google says into one of those four states, and nothing else in
 * the server knows Play exists.
 *
 * That separation is not tidiness. **The states that actually hurt a farm
 * cannot be produced on demand in a store sandbox** — a card that expires in
 * March, a hold that lifts a week later, a refund three months on — so the
 * decisions about them have to be testable without Google. What is left here
 * is a mapping and an HTTP call, and the mapping is tested below the seam.
 *
 * ## No `googleapis`
 *
 * The client library is forty megabytes to make one authenticated GET. `jose`
 * is already a dependency for the app's own tokens and mints the
 * service-account assertion in nine lines, so the platform primitive is
 * sufficient and the dependency is not added.
 *
 * ## The service account key is the one real secret here
 *
 * Unlike an OAuth client id, this is a private key and it is server-side only
 * — invariant 12 in its plainest form. It never appears in a bundle, a log
 * line, or an error message.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

/** What a service-account JSON has to carry to be usable. Parsed, never cast. */
const serviceAccountSchema = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
});

export interface PlayConfig {
  clientEmail: string;
  privateKey: string;
  packageName: string;
}

/**
 * Reads the service account out of an environment variable.
 *
 * Returns null when it is absent, which is a supported state rather than a
 * failure: a server with no Play credentials answers the billing routes with
 * a 501 naming the variable, exactly as Google sign-in does. Every other route
 * keeps working, and a farm on the free tier notices nothing.
 */
export function readPlayConfig(
  raw: string | undefined,
  packageName: string | undefined,
): PlayConfig | null {
  if (!raw || !packageName) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT is not valid JSON.');
  }

  const account = serviceAccountSchema.safeParse(parsed);
  if (!account.success) {
    // Names the field and never the value: this object holds a private key.
    throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT needs client_email and private_key.');
  }

  return {
    clientEmail: account.data.client_email,
    // A key pasted through a shell arrives with literal backslash-n.
    privateKey: account.data.private_key.replace(/\\n/g, '\n'),
    packageName,
  };
}

/**
 * Play's own subscription states, and what each means for a farm.
 *
 * **`CANCELED` is entitled**, which is the one that looks wrong and is not: a
 * farm that turns off auto-renew in October has paid through to its expiry
 * date and is owed the service until then. Google keeps reporting the state as
 * canceled for that whole period. Treating it as lapsed would cut a farm off
 * from something it has already paid for — the single most indefensible bug
 * this file could have.
 *
 * **`PAUSED` and `ON_HOLD` are not entitled**, and they are different from
 * grace: grace is Google actively retrying a payment, where hold is what
 * happens after the retries fail. The distinction matters because grace keeps
 * syncing and hold does not; see `entitlementOf`.
 *
 * **`PENDING` is not entitled.** Nothing has been paid yet.
 */
const PLAY_STATES: Record<string, SubscriptionState> = {
  SUBSCRIPTION_STATE_ACTIVE: 'active',
  SUBSCRIPTION_STATE_CANCELED: 'active',
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'grace',
  SUBSCRIPTION_STATE_ON_HOLD: 'lapsed',
  SUBSCRIPTION_STATE_PAUSED: 'lapsed',
  SUBSCRIPTION_STATE_EXPIRED: 'lapsed',
  SUBSCRIPTION_STATE_PENDING: 'lapsed',
  SUBSCRIPTION_STATE_UNSPECIFIED: 'lapsed',
};

/** What `purchases.subscriptionsv2.get` returns, of the parts this reads. */
const purchaseSchema = z.object({
  subscriptionState: z.string(),
  lineItems: z
    .array(z.object({ expiryTime: z.string().optional(), productId: z.string().optional() }))
    .optional(),
});

/**
 * Turns a Play purchase into the shape the entitlement rules read.
 *
 * Exported separately from the fetch so the mapping — which is where the
 * judgement lives — is testable against every state Google documents, without
 * a console, a network, or a sandbox purchase.
 *
 * **An unknown state maps to `lapsed`, deliberately.** Google adds states; a
 * default of `active` would mean a state nobody has read about yet silently
 * granting service, and a default of `lapsed` means it silently withholds it.
 * The second is visible — a farm complains — and the first is not.
 */
export function subscriptionFrom(raw: unknown, now: number): Subscription {
  const parsed = purchaseSchema.safeParse(raw);
  if (!parsed.success) return { state: 'lapsed', source: 'play', updatedAt: now };

  const state = PLAY_STATES[parsed.data.subscriptionState] ?? 'lapsed';

  /**
   * The furthest expiry across line items.
   *
   * A subscription has one line item today. `max` rather than `[0]` because a
   * plan change can briefly show two, and cutting a farm off at the earlier of
   * them would end service it has paid for.
   */
  const expiries = (parsed.data.lineItems ?? [])
    .map((item) => (item.expiryTime === undefined ? NaN : Date.parse(item.expiryTime)))
    .filter((ms) => Number.isFinite(ms));

  const productId = parsed.data.lineItems?.find((item) => item.productId)?.productId;

  return {
    state,
    ...(expiries.length > 0 ? { expiresAt: Math.max(...expiries) } : {}),
    ...(productId === undefined ? {} : { productId }),
    source: 'play',
    updatedAt: now,
  };
}

/**
 * A short-lived access token for the Play Developer API.
 *
 * The standard service-account flow: sign an assertion with the private key,
 * exchange it for a bearer token. Not cached — this runs on a purchase and on
 * a store notification, which is a handful of times per farm per year, and a
 * cache would be a stale-credential bug waiting for the one day it matters.
 */
async function accessToken(config: PlayConfig, fetchImpl = fetch): Promise<string> {
  const key = await importPKCS8(config.privateKey, 'RS256');
  const now = Math.floor(Date.now() / 1000);

  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(config.clientEmail)
    .setSubject(config.clientEmail)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(key);

  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  if (!res.ok) throw new HttpError(502, 'Could not reach the store to check that purchase.');

  const body: unknown = await res.json().catch(() => null);
  const token = (body as { access_token?: unknown } | null)?.access_token;
  if (typeof token !== 'string') {
    throw new HttpError(502, 'Could not reach the store to check that purchase.');
  }
  return token;
}

/**
 * Asks Google what this purchase token is worth, now.
 *
 * **Always asked of Google, never trusted from the device.** A purchase token
 * arrives from a handset, and a handset can send anything; what makes it
 * evidence is that Google confirms it against the package this server was
 * configured with. A token for somebody else's app, a replayed token, or an
 * invented one all fail here.
 */
export async function readPlaySubscription(
  config: PlayConfig,
  purchaseToken: string,
  now = Date.now(),
  fetchImpl = fetch,
): Promise<Subscription> {
  const token = await accessToken(config, fetchImpl);

  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(config.packageName)}/purchases/subscriptionsv2/tokens/` +
    `${encodeURIComponent(purchaseToken)}`;

  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });

  /**
   * A 404 is a real answer rather than an outage: Google does not know this
   * token, so it buys nothing. Anything else is the store being unreachable,
   * and **an unreachable store must never downgrade a paying farm** — it
   * throws, the route reports it, and whatever was already stored stands.
   */
  if (res.status === 404) return { state: 'lapsed', source: 'play', updatedAt: now };
  if (!res.ok) throw new HttpError(502, 'Could not reach the store to check that purchase.');

  return subscriptionFrom(await res.json().catch(() => null), now);
}
