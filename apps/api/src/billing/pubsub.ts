import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';

/**
 * Proving that a store notification came from Google.
 *
 * ## What was there before, which was nothing
 *
 * `POST /billing/notifications` is the endpoint Google Cloud Pub/Sub pushes
 * subscription changes to. It was unauthenticated, unthrottled, and reachable
 * from anywhere on the internet.
 *
 * **The state it writes was never forgeable**, and that part of the design was
 * right: the handler takes only a purchase token out of the body and then asks
 * *Google* what that purchase is worth now, so an invented payload cannot make
 * a farm entitled. What was open was the cost. Every unauthenticated request
 * that named a real token spent an outbound Play API call and a database write,
 * on a route with no limit on it — somebody else's quota, and the server's
 * time, available to anybody.
 *
 * ## An OIDC token, which Pub/Sub was already able to send
 *
 * A push subscription can be configured with a service account, and Google then
 * signs every delivery with an OIDC token in the `Authorization` header — the
 * same shape and the same key set as a Google ID token, which
 * `auth/google.ts` already verifies for sign-in. So this is the check that
 * mechanism was built for, pointed at a different audience.
 *
 * ## Off until configured, and said out loud
 *
 * `GOOGLE_PUBSUB_AUDIENCE` has no default, exactly like `EMAIL_FROM`: the value
 * is whatever the operator typed into the push subscription, and this file
 * cannot guess it. Unset, the route keeps its old behaviour minus the
 * amplification — rate limited, package-checked, and still asking Google before
 * believing anything.
 *
 * **That is not a fail-open on authorization** (invariant 10) and the
 * distinction is worth being exact about: nothing here authorises a state
 * change. The state comes from Google's own answer on a connection this server
 * opened. This gate decides whether a stranger may *make the server ask*, which
 * is a cost control, and a server whose operator has not configured one is a
 * server that has chosen the rate limit alone.
 */

const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');

/** Cached and rotated by `jose`, for the reason `auth/google.ts` gives. */
let keys: ReturnType<typeof createRemoteJWKSet> | null = null;

function jwks(): ReturnType<typeof createRemoteJWKSet> {
  keys ??= createRemoteJWKSet(JWKS_URL);
  return keys;
}

/** Tests only: drops the cached key set so a fake can be installed. */
export function resetPubsubKeys(): void {
  keys = null;
}

/**
 * The claims worth reading off a push token, parsed rather than cast.
 *
 * `email_verified` is Google asserting the service account address is one it
 * issued, which is what makes `email` worth comparing against anything. Both are
 * optional in the general OIDC case and present on a Pub/Sub push token.
 */
const pushClaimsSchema = z.object({
  email: z.string().email().optional(),
  email_verified: z.boolean().optional(),
});

export interface PushIdentity {
  /** The service account Pub/Sub is pushing as, when it said. */
  email: string | undefined;
}

/**
 * Verifies signature, issuer, audience and expiry.
 *
 * Throws for every failure without distinguishing them — an expired token, one
 * minted for a different audience, and a forged one are all the same refusal,
 * for the reason `verifyGoogleIdToken` gives about not telling an attacker
 * which part to work on. The caller answers 200 regardless, because a push
 * endpoint that answers anything else invites Pub/Sub to retry.
 */
export async function verifyPushToken(
  authorization: string | undefined,
  audience: string,
  verify = jwtVerify,
): Promise<PushIdentity> {
  const [scheme, token] = (authorization ?? '').split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new Error('No push token.');
  }

  const { payload } = await verify(token, jwks(), { issuer: ISSUERS, audience });

  const parsed = pushClaimsSchema.safeParse(payload);
  if (!parsed.success) throw new Error('Push token claims could not be read.');

  return {
    email:
      parsed.data.email_verified === true ? parsed.data.email : undefined,
  };
}
