import type { FastifyRequest } from 'fastify';
import type { Role } from '@steading/contracts';
import { HttpError } from '../http';
import { resolvePrincipal, type SessionClaims, UnauthorizedError } from './principal';
import { verifyAccessToken } from './tokens';

/**
 * Turns a request into a principal, or throws 401.
 *
 * Two steps, and the second is the one that matters: the token proves who
 * presented it, and the user document decides what they are allowed to be.
 * A token issued before a demotion, a disable, or an org move carries stale
 * claims, and none of them survive this function (invariant 8).
 */
export async function requireAuth(request: FastifyRequest): Promise<SessionClaims> {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    throw new HttpError(401, 'Sign in again.');
  }

  const userId = await verifyAccessToken(header.slice('Bearer '.length).trim());

  try {
    return await resolvePrincipal(userId);
  } catch (error) {
    if (error instanceof UnauthorizedError) throw new HttpError(401, error.message);
    throw error;
  }
}

/**
 * Route-level role gate.
 *
 * Deliberately NOT used on /sync. A batch mixes entities, and rejecting the
 * whole thing because one mutation is above the caller's role would strand the
 * rest of a morning's work; sync checks role per mutation instead. This is for
 * routes where the whole request is the operation.
 */
export function requireRole(claims: SessionClaims, allowed: readonly Role[]): void {
  if (!allowed.includes(claims.role)) {
    // 404-shaped elsewhere, but here the resource is not in question — the
    // caller is authenticated and simply cannot do this.
    throw new HttpError(403, 'Your role cannot do that.');
  }
}
