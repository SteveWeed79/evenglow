import { findUserById } from '../db/identity';
import { HttpError } from '../http';
import type { SessionClaims } from './claims';
import { bearerFrom, verifyAccessToken } from './tokens';

/**
 * The two gates: one for reading, one for writing.
 *
 * They mirrored the Next handlers when both servers were live, and that
 * justification outlived the Next app — it is deleted, and this is the only
 * server. What the pairing is actually for is stated below: a read may be
 * decided by a signature, and a write may not.
 */

/**
 * Read path. The token's signature is proof we issued it, and that is enough
 * to decide what to render. It is a snapshot, though: a role changed or an
 * account disabled after issue is not reflected until the token expires.
 */
export async function requireClaims(
  authorization: string | undefined,
  secret: string,
): Promise<SessionClaims> {
  const token = bearerFrom(authorization);
  if (!token) throw new HttpError(401, 'Not signed in.');
  return verifyAccessToken(token, secret);
}

/**
 * Write path. Re-derives identity, org and role from the database on every
 * mutation (D4, invariant 8) rather than trusting the token's snapshot.
 *
 * One indexed lookup by _id. The mutation path is already going to Mongo, so
 * this buys literal compliance with "the server re-authorizes every mutation
 * at flush" for effectively nothing.
 */
export async function requireMutationClaims(
  authorization: string | undefined,
  secret: string,
): Promise<SessionClaims> {
  const claims = await requireClaims(authorization, secret);
  const user = await findUserById(claims.userId);

  if (!user || user.disabledAt) {
    throw new HttpError(401, 'This account is no longer active.');
  }

  // A token minted before the user moved orgs must not reach the old tenant.
  if (user.orgId !== claims.orgId) {
    throw new HttpError(401, 'Your account has changed. Sign in again.');
  }

  return { userId: user._id, orgId: user.orgId, role: user.role };
}
