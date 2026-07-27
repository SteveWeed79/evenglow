import type { Role } from '@steading/contracts';

/**
 * The verified identity behind a request.
 *
 * Lives here rather than with a session implementation because the appliers
 * take it and neither of them cares how it was established — an Auth.js JWT
 * today, a `jose`-verified access token from S3b. Both servers produce this
 * same shape, which is what lets one applier serve both.
 *
 * Every field is server-derived. None of it is ever read from a payload
 * (D4, invariant 2).
 */
export interface SessionClaims {
  userId: string;
  orgId: string;
  role: Role;
}
