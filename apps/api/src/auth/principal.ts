import type { Role } from '@steading/contracts';
import { findUserById } from '../db/identity';

/**
 * The identity a mutation is applied under.
 *
 * Deliberately not the token payload. A token is a claim about who someone was
 * when it was issued; this is what the user document says right now. The
 * distinction is invariant 8 — cached claims gate local UX only, and the
 * server re-derives identity, org, and role on every mutation at flush.
 */
export interface SessionClaims {
  userId: string;
  orgId: string;
  role: Role;
}

export class UnauthorizedError extends Error {
  constructor(message = 'Sign in again.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Re-derives the principal from storage for a verified token subject.
 *
 * Throws rather than returning null for every failure mode — a deleted user, a
 * disabled account, an org that no longer exists — because there is no caller
 * for whom "no principal" is a valid state to continue from (invariant 10).
 *
 * The role and orgId returned here always win over anything in the token, so a
 * demotion or a disable takes effect on the next flush rather than on the next
 * token refresh.
 */
export async function resolvePrincipal(userId: string): Promise<SessionClaims> {
  const user = await findUserById(userId);
  if (!user || user.disabledAt) throw new UnauthorizedError();

  return { userId: user._id, orgId: user.orgId, role: user.role };
}
