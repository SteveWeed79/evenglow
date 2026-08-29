import { findUserById } from '../db/identity';
import { HttpError } from '../http';
import type { SessionClaims } from './claims';
import { bearerFrom, verifyAccessToken } from './tokens';

/**
 * The gate, and why there is no longer a cheaper one for reads.
 *
 * These were two functions. The read path verified the signature and stopped
 * there, on the argument that *"the token's signature is proof we issued it,
 * and that is enough to decide what to render"* — a snapshot, explicitly, with
 * a note that an account disabled after issue *"is not reflected until the
 * token expires."*
 *
 * ## What that snapshot actually covered
 *
 * Every read route on this server: `GET /snapshot` — a **whole-farm export** —
 * plus `/photos/:id`, `/members`, `/join-codes` and `/billing`. So somebody
 * removed from a farm went on holding the farm's entire dataset, its roster,
 * its join codes and its subscription state for the rest of the access token's
 * fifteen minutes. `identity.ts` says of removal that *"access ends
 * immediately"*; it did not, and the removal a farm makes for cause is the one
 * where those fifteen minutes are the whole point.
 *
 * Invariant 10 is *never fail open on authorization*. A read that keeps
 * answering for a revoked account is failing open, quietly, on the largest
 * response this API produces.
 *
 * ## The cost, which is why the split was never worth it
 *
 * One indexed lookup by `_id`. Every one of those five routes is already going
 * to Mongo — `/snapshot` to read the entire farm — so this is the same trade
 * the write path already documented as *"effectively nothing"*, made twice.
 *
 * `requireMutationClaims` is kept as the name every write site calls, because
 * renaming twelve call sites is churn that could drop one, and because the name
 * says what it is for. It is now the same check: a mutation has no weaker
 * requirement than a read, and if the two ever diverge again it must be the
 * write side tightening rather than the read side loosening.
 */
export async function requireClaims(
  authorization: string | undefined,
  secret: string,
): Promise<SessionClaims> {
  const token = bearerFrom(authorization);
  if (!token) throw new HttpError(401, 'Not signed in.');
  const claims = await verifyAccessToken(token, secret);

  // Re-derived from the database rather than read off the token (D4,
  // invariant 8). The token is proof of who signed in; it is not proof that
  // they still belong here.
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

/**
 * Write path. The same check, under the name every mutation site calls it by.
 *
 * See above for why it is no longer a stronger one than the read path.
 */
export async function requireMutationClaims(
  authorization: string | undefined,
  secret: string,
): Promise<SessionClaims> {
  return requireClaims(authorization, secret);
}
