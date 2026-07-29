import { z } from 'zod';
import { type Role, ROLES, roleSchema } from './roles';

/**
 * Who may add, promote and remove whom.
 *
 * D7 built the role matrix and never built the way to get a second person onto
 * a farm. Two people logging the same morning is the ordinary case on any farm
 * with help, and until now the only route was for the owner to hand over their
 * password.
 *
 * These are pure functions and they live here for the same reason `canMutate`
 * does: the client uses them to hide controls, the server uses them to
 * enforce. **The client copy is UX only and is never the control** (D4,
 * invariant 8) — every one of these is re-evaluated server-side against the
 * database on the request that acts.
 */

/** A hand records what happened; they do not decide who else may. */
export function canInvite(role: Role): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * The roles a given role may grant.
 *
 * **An admin cannot mint an owner.** That is privilege escalation with extra
 * steps: an admin who could invite an owner could invite themselves back as
 * one, and the distinction between the two roles would mean nothing. Lateral
 * grants are fine — an admin inviting an admin adds no power that admin did
 * not already have.
 */
export function assignableRoles(role: Role): Role[] {
  if (role === 'owner') return [...ROLES];
  if (role === 'admin') return ['admin', 'hand'];
  return [];
}

export function canAssign(actor: Role, target: Role): boolean {
  return assignableRoles(actor).includes(target);
}

export interface MembershipChange {
  actorId: string;
  actorRole: Role;
  targetId: string;
  targetRole: Role;
  /** How many owners the org has, counting the target. */
  ownerCount: number;
}

export const MEMBERSHIP_REFUSALS = [
  'not-permitted',
  'cannot-assign-that-role',
  'last-owner',
  'self',
] as const;
export type MembershipRefusal = (typeof MEMBERSHIP_REFUSALS)[number];

/**
 * Whether one member may change another's role.
 *
 * Three refusals, and each closes a way a farm could lock itself out or a
 * member could grant themselves power:
 *
 * - **`self`** — nobody changes their own role. It stops an admin promoting
 *   themselves to owner, and it stops an owner demoting themselves out of the
 *   only role that can undo it.
 * - **`last-owner`** — the final owner cannot be demoted. A farm with no owner
 *   has nobody who can invite one, and the recovery path is a support request
 *   to a project that has no support.
 * - **`cannot-assign-that-role`** — see `assignableRoles`.
 */
export function refuseRoleChange(change: MembershipChange, next: Role): MembershipRefusal | null {
  if (!canInvite(change.actorRole)) return 'not-permitted';
  if (change.actorId === change.targetId) return 'self';
  if (!canAssign(change.actorRole, next)) return 'cannot-assign-that-role';

  // Demoting the last owner. Promoting one is always safe.
  if (change.targetRole === 'owner' && next !== 'owner' && change.ownerCount <= 1) {
    return 'last-owner';
  }

  // An admin cannot act on an owner at all, in either direction.
  if (change.actorRole === 'admin' && change.targetRole === 'owner') return 'not-permitted';

  return null;
}

/**
 * Whether one member may remove another.
 *
 * Removing yourself is refused for the same reason changing your own role is:
 * leaving is a different action with a different confirmation, and an accident
 * here costs someone their access to the farm they are standing on.
 */
export function refuseRemoval(change: MembershipChange): MembershipRefusal | null {
  if (!canInvite(change.actorRole)) return 'not-permitted';
  if (change.actorId === change.targetId) return 'self';
  if (change.actorRole === 'admin' && change.targetRole === 'owner') return 'not-permitted';
  if (change.targetRole === 'owner' && change.ownerCount <= 1) return 'last-owner';
  return null;
}

/** The sentence shown when an action is refused. Named, never a bare 403. */
export function refusalMessage(refusal: MembershipRefusal): string {
  switch (refusal) {
    case 'not-permitted':
      return 'You do not have permission to do that.';
    case 'cannot-assign-that-role':
      return 'You cannot give someone a role above your own.';
    case 'last-owner':
      return 'A farm needs at least one owner. Make someone else an owner first.';
    case 'self':
      return 'You cannot change your own role.';
  }
}

// ── the invite itself ────────────────────────────────────────────────────────

/** Seven days. Long enough to reach someone, short enough that a stale link dies. */
export const INVITE_TTL_DAYS = 7;

/**
 * Creating an invite.
 *
 * **The email is required, and the invite is bound to it.** A bearer link
 * would be simpler and is what most small products ship, but the link travels
 * by text message and sits in a phone forever; binding it means a leaked link
 * is useless to anyone but the person it was for. Typing a farmhand's email
 * once is not a burden worth trading that for.
 */
export const inviteCreateSchema = z
  .object({
    email: z.string().email().max(254),
    role: roleSchema,
    name: z.string().min(1).max(80).optional(),
  })
  .strict();

export type InviteCreate = z.infer<typeof inviteCreateSchema>;

/**
 * Accepting one.
 *
 * The email is sent again rather than taken from the invite, and that is the
 * check: the token proves someone has the link, the email proves they are who
 * it was for.
 */
export const inviteAcceptSchema = z
  .object({
    token: z.string().min(20).max(200),
    email: z.string().email().max(254),
    password: z.string().min(12).max(200),
    name: z.string().min(1).max(80),
  })
  .strict();

export type InviteAccept = z.infer<typeof inviteAcceptSchema>;

/** What a pending invite looks like to the farm that sent it. */
export interface PendingInvite {
  id: string;
  email: string;
  role: Role;
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
}

/** What the person holding the link is shown before they accept. */
export interface InvitePreview {
  orgName: string;
  role: Role;
  email: string;
  expiresAt: number;
}
