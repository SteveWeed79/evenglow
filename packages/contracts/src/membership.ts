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

/**
 * Claiming a farm that already exists on a device (A2.2).
 *
 * **`orgId` is sent by the client, and it is the only route in this system
 * where that is true.** Invariant 2 forbids reading an orgId from a payload,
 * and this does not breach it: the invariant governs *authorizing an
 * operation against an existing tenant*, where a payload-supplied org would
 * let a caller act inside somebody else's farm. Signup creates the tenant. At
 * the moment this route runs there is no tenant to reach into, and every
 * request afterwards derives the org from the verified token exactly as now.
 *
 * The defence is structural rather than a check somebody has to remember.
 * `insertOrg` uses the ULID as the document `_id`, and `_id` uniqueness in
 * MongoDB is not an index that can be dropped or forgotten to be created — it
 * is the collection. A second claim on the same id is a hard duplicate-key
 * failure, so two farms can never silently merge into one. That is the same
 * guarantee that turned out to be protecting the photo route.
 *
 * A ULID also carries 80 bits of randomness, so an id cannot be guessed by
 * somebody hoping to claim a farm they have never seen.
 *
 * The alternative — the server assigning an id and the device renaming its
 * database at claim time — was rejected in A2.2: a rename plus a token write
 * is two operations that must both survive a crash, and a half-claimed org is
 * exactly the divergence invariant 5 exists to prevent.
 */
export const signupSchema = z
  .object({
    orgId: z.string().length(26),
    orgName: z.string().min(1).max(120),
    email: z.string().email().max(254),
    password: z.string().min(12).max(200),
    name: z.string().min(1).max(80),
  })
  .strict();

export type Signup = z.infer<typeof signupSchema>;

/**
 * Join codes (A2.5) — six characters, shown by the owner and typed by the hand
 * standing next to them.
 *
 * **Crockford's alphabet, which is the whole reason six characters is
 * enough to be usable.** No I, L, O or U: nothing in a code can be misread as
 * a one or a zero across a yard, and nothing spells a word by accident. The
 * server normalises on the way in, so a hand who types `l` for `1` is
 * understood rather than told they are wrong.
 */
export const JOIN_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const JOIN_CODE_LENGTH = 6;

/**
 * Ten minutes.
 *
 * `invites.ts` says flatly that no rate limit makes a guessable invite safe,
 * and that is right about a link that sits in a phone for a week. This is a
 * different object: it exists only while the owner is holding their phone out,
 * it is single use, and it dies on its own. 32^6 is a billion, the window is
 * ten minutes, and the redeem route is rate limited — so the expected number
 * of successful guesses is far below one even if somebody spends the whole
 * window guessing. The long invite token stays for anyone who wants to send a
 * link instead.
 */
export const JOIN_CODE_TTL_MINUTES = 10;

/** Uppercased, with the characters Crockford treats as the same letter folded. */
export function normalizeJoinCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V')
    .replace(/[^0-9A-Z]/g, '');
}

/**
 * What a role is called on screen.
 *
 * Here rather than in a screen because two now say it — Members, listing who is
 * on the farm, and Account, telling somebody what an invitation makes them. The
 * wire name and the spoken name differ (`admin` is "Manager"), which is exactly
 * the kind of pair that drifts when it is written down twice.
 */
export const ROLE_WORDS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Manager',
  hand: 'Farm hand',
};

/**
 * Which of the two things somebody was handed.
 *
 * A farm can pass on a **six-character code** read off a phone at the gate, or
 * a **43-character link** sent by text to a particular address. Both end up in
 * the same box, because the person holding one did not choose which they were
 * given and should not have to know there are two.
 *
 * They cannot be confused: a join code is six characters of Crockford and an
 * invite token is 32 random bytes as base64url, which is 43. Length alone
 * separates them by a mile, and the alphabet check makes a near-miss fall to
 * the invite branch — where the server refuses it — rather than being sent to
 * the redeem route as a malformed code.
 *
 * The server is the authority on both either way. This only decides which door
 * to knock on.
 */
export function looksLikeJoinCode(raw: string): boolean {
  const normalized = normalizeJoinCode(raw);
  return (
    normalized.length === JOIN_CODE_LENGTH &&
    [...normalized].every((character) => JOIN_CODE_ALPHABET.includes(character))
  );
}

/**
 * Minting one.
 *
 * The role is chosen when the code is made rather than when it is redeemed,
 * because the person choosing is the one with the authority to grant it — and
 * a code that let the holder pick their own role would be a code that made
 * everybody an owner.
 *
 * Defaults to `hand`, which is what an owner standing in a yard with a
 * seasonal worker almost always means.
 */
export const joinCodeCreateSchema = z
  .object({ role: roleSchema.default('hand') })
  .strict();

export type JoinCodeCreate = z.infer<typeof joinCodeCreateSchema>;

export const joinCodeRedeemSchema = z
  .object({
    code: z.string().min(1).max(20),
    email: z.string().email().max(254),
    password: z.string().min(12).max(200),
    name: z.string().min(1).max(80),
  })
  .strict();

export type JoinCodeRedeem = z.infer<typeof joinCodeRedeemSchema>;

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

/**
 * Signing in with Google (A2.4).
 *
 * The org fields are optional and travel together: a device holding an
 * unclaimed farm sends them so that a first-time Google sign-in claims that
 * farm rather than starting an empty one, and a device that is merely signing
 * in on a second phone sends neither. The server decides which case it is,
 * because whether an address already has an account is precisely the question
 * a sign-in screen must not be able to ask.
 *
 * `name` is a fallback only. Google supplies one on almost every account; this
 * covers the ones where the profile scope returns nothing.
 */
export const googleSignInSchema = z
  .object({
    idToken: z.string().min(1).max(8192),
    orgId: z.string().length(26).optional(),
    orgName: z.string().min(1).max(120).optional(),
    name: z.string().min(1).max(80).optional(),
  })
  .strict();

export type GoogleSignIn = z.infer<typeof googleSignInSchema>;
