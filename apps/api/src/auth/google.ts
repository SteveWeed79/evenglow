import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { HttpError } from '../http';

/**
 * Verifying a Google ID token (A2.4).
 *
 * Android first, one tap, nothing to type with a glove on, and no password for
 * a farm to store, reset or forget. LookOver — the nearest philosophical
 * sibling — does exactly this and advertises sixty seconds.
 *
 * ## What the client sends and why it is safe to accept
 *
 * The device runs the Google flow itself and hands the server the resulting
 * **ID token**, never an access token and never a profile it assembled. An ID
 * token is a JWT signed by Google, so the server checks the signature against
 * Google's published keys and the claims against its own configuration. A
 * caller who invents a token, replays one issued to a different app, or edits
 * the email inside one gets a 401 — the same 401 as an expired session.
 *
 * The audience check is the part that carries the weight. **A valid Google ID
 * token issued to some other application is still a valid Google ID token**,
 * so a server that verified only the signature would accept a token minted for
 * anybody's app and sign that person in as its owner. The audience must be one
 * of *our* client ids and nothing else.
 *
 * ## Invariant 12 is untouched
 *
 * OAuth client ids are public by design — they ship in the APK because they
 * have to. The client *secret* is not used at all: the native flow is PKCE, so
 * there is no secret on the device, and the server never exchanges a code. The
 * only configuration here is a list of public identifiers.
 */

/**
 * Google's issuer strings.
 *
 * Both, because Google has issued tokens under each for years and which one
 * appears is not something this app controls. Pinning only the bare hostname
 * would reject perfectly good tokens on some devices.
 */
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');

/**
 * Fetched once and cached by `jose`, which also handles rotation.
 *
 * Module scope rather than per-request: Google rotates these keys and a fetch
 * on every sign-in would be a hard dependency on their latency in the one
 * place a farmer is watching a spinner.
 */
let keys: ReturnType<typeof createRemoteJWKSet> | null = null;

function jwks(): ReturnType<typeof createRemoteJWKSet> {
  keys ??= createRemoteJWKSet(JWKS_URL);
  return keys;
}

/** Tests only: drops the cached key set so a fake can be installed. */
export function resetGoogleKeys(): void {
  keys = null;
}

/**
 * The claims this app uses, parsed rather than cast (invariant 11).
 *
 * `sub` is the identity — it is stable when somebody changes the address on
 * their Google account, which an email is not. The email is what a farm
 * recognises and what an existing password account is matched on, so both are
 * kept.
 *
 * `email_verified` is required to be true. Google will issue a token for an
 * unverified address on some account types, and treating one as proof of an
 * email would let somebody claim an account belonging to whoever really owns
 * that address.
 */
const googleClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.literal(true),
  name: z.string().max(200).optional(),
});

export interface GoogleIdentity {
  googleSub: string;
  email: string;
  name: string | undefined;
}

/**
 * Verifies signature, issuer, audience and expiry, then the claim shape.
 *
 * One answer for every failure, like `verifyAccessToken`: an expired token, a
 * token for another app and a forged one are all "that Google sign-in did not
 * work". Distinguishing them tells an attacker which part to work on.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  audiences: string[],
  verify = jwtVerify,
): Promise<GoogleIdentity> {
  if (audiences.length === 0) {
    /**
     * Configuration, not a credential problem, so it does not get the generic
     * answer — a 501 with a sentence naming the variable is what an operator
     * can act on, and a farm seeing it has hit a server that was never set up
     * for Google rather than a Google account that does not work.
     */
    throw new HttpError(501, 'This server is not set up for Google sign-in.');
  }

  const refused = new HttpError(401, 'That Google sign-in did not work. Try again.');

  let payload: unknown;
  try {
    ({ payload } = await verify(idToken, jwks(), {
      issuer: ISSUERS,
      // The check that stops a token minted for somebody else's app being
      // accepted as one of ours.
      audience: audiences,
    }));
  } catch {
    throw refused;
  }

  const parsed = googleClaimsSchema.safeParse(payload);
  if (!parsed.success) throw refused;

  return {
    googleSub: parsed.data.sub,
    email: parsed.data.email,
    name: parsed.data.name,
  };
}
