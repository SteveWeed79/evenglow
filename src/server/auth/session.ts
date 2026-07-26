import type { Entity, Op } from '@/lib/contracts/mutation';
import { canMutate, isRole, type Role } from '@/lib/contracts/roles';
import { findUserById } from '@/server/db/identity';
import { HttpError } from '@/server/http';
import { auth } from './config';

export interface SessionClaims {
  userId: string;
  orgId: string;
  role: Role;
}

/**
 * Read-path session. Claims come from the server-signed JWT, so they are
 * trustworthy as *authentication*, but they are a snapshot: a role changed or
 * an account disabled after issue is not reflected until the token refreshes.
 *
 * Good enough for deciding what to render. Not good enough for a write —
 * see requireMutationSession.
 */
export async function requireSession(): Promise<SessionClaims> {
  const session = await auth();
  const user = session?.user;

  if (!user?.id || !user.orgId || !isRole(user.role)) {
    throw new HttpError(401, 'Not signed in.');
  }

  return { userId: user.id, orgId: user.orgId, role: user.role };
}

/**
 * Write-path session. Re-derives identity, org, and role from the database on
 * every mutation (D4, invariant 5) rather than trusting the token's snapshot.
 *
 * This costs one indexed lookup by _id. The mutation path is already going to
 * Mongo, so the extra round trip buys literal compliance with "the server
 * re-authorizes every mutation at flush time" for effectively nothing.
 */
export async function requireMutationSession(): Promise<SessionClaims> {
  const claims = await requireSession();
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

export function requireRole(role: Role, allowed: readonly Role[]): void {
  if (!allowed.includes(role)) throw new HttpError(403, 'You do not have access to that.');
}

/** Per-mutation authorization. Rejects one mutation, never the whole batch. */
export function mayMutate(role: Role, entity: Entity, op: Op): boolean {
  return canMutate(role, entity, op);
}
