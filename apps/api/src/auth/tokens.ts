import { jwtVerify, SignJWT } from 'jose';
import { isRole } from '@steading/contracts';
import { HttpError } from '../http';
import type { SessionClaims } from './claims';

/**
 * Access tokens (T7).
 *
 * Short-lived and stateless: the whole point is that a mutation can be
 * authorised without a database round trip for identity. The trade is that a
 * role change or a disabled account is not reflected until the token expires,
 * which is why the *write* path re-derives from the database anyway (D4) and
 * this is only the first gate.
 */

const ISSUER = 'steading';
const AUDIENCE = 'steading-app';

/**
 * Fifteen minutes. Long enough that a refresh is not on the critical path of
 * a flush, short enough that a leaked token is not a standing key. The client
 * is expected to hold a token far longer than this offline — that is what the
 * refresh token is for, and an expired access token never blocks local
 * logging, only the flush.
 */
const ACCESS_TTL_SECONDS = 15 * 60;

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function mintAccessToken(
  claims: SessionClaims,
  secret: string,
  now = new Date(),
): Promise<string> {
  return new SignJWT({ orgId: claims.orgId, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(now.getTime() / 1000) + ACCESS_TTL_SECONDS)
    .sign(key(secret));
}

/**
 * Verifies signature, issuer, audience and expiry, then re-checks the claim
 * shape.
 *
 * The shape check is not belt-and-braces: a token signed with the right secret
 * is only proof that *we* issued it, not that it carries what this build
 * expects. A role string that no longer exists must be a 401, never an
 * `as Role` that flows into an authorization decision (invariant 11).
 */
export async function verifyAccessToken(token: string, secret: string): Promise<SessionClaims> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
    }));
  } catch {
    // Expired, tampered, wrong audience — all one answer. Distinguishing them
    // tells an attacker which part of the token to work on.
    throw new HttpError(401, 'Your session has expired. Sign in again.');
  }

  const { sub, orgId, role } = payload;
  if (typeof sub !== 'string' || typeof orgId !== 'string' || !isRole(role)) {
    throw new HttpError(401, 'Your session has expired. Sign in again.');
  }

  return { userId: sub, orgId, role };
}

/** Pulls a bearer token out of an Authorization header. */
export function bearerFrom(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value;
}
