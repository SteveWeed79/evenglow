import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Collection } from 'mongodb';
import type { Role } from '@steading/contracts';
import { db } from './client';
import { normalizeEmail } from './identity';

/**
 * Invites, stored hashed.
 *
 * Like `identity.ts` and `refresh-tokens.ts`, this collection is deliberately
 * NOT tenant-scoped — the whole point of an invite is that it is redeemed by
 * somebody who has no session and therefore no orgId yet, so `scoped()` cannot
 * serve the accept path.
 *
 * That makes a fourth collection the tenancy mechanism cannot structurally
 * protect, so it follows the same discipline as the other three: no collection
 * handle leaves this module, and every function is purpose-built and narrow.
 *
 * **The org-scoped reads take orgId as a required argument and every one of
 * them passes it into the filter.** That is weaker than `scoped()`, which
 * makes forgetting impossible; it is the price of a collection the redeemer
 * must reach before they belong to anything. `tests/isolation` covers it.
 */

export interface InviteDoc {
  /** SHA-256 of the token. The token itself is never stored. */
  _id: string;
  /** A stable id the farm can revoke by, safe to show and to log. */
  publicId: string;
  orgId: string;
  email: string;
  role: Role;
  name?: string;
  invitedByUserId: string;
  invitedByName: string;
  createdAt: Date;
  expiresAt: Date;
  /** Set on acceptance. A second acceptance is refused. */
  acceptedAt?: Date;
  acceptedByUserId?: string;
  revokedAt?: Date;
}

async function invites(): Promise<Collection<InviteDoc>> {
  return (await db()).collection<InviteDoc>('invites');
}

/**
 * 256 bits from a CSPRNG, base64url.
 *
 * The token is the only secret protecting a role on someone's farm, and it
 * travels by text message. There is no rate limit that makes a guessable
 * invite safe, so it is not guessable.
 */
export function mintInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256, not argon2, for the same reason refresh tokens use it: there is
 * nothing to brute-force in 256 bits of CSPRNG output. What hashing buys is
 * that a database disclosure does not hand over usable invites.
 */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function insertInvite(doc: InviteDoc): Promise<void> {
  await (await invites()).insertOne({ ...doc, email: normalizeEmail(doc.email) });
}

/** Presenting the token IS the lookup — there is no query here a caller could widen. */
export async function findInviteByToken(token: string): Promise<InviteDoc | null> {
  return (await invites()).findOne({ _id: hashInviteToken(token) });
}

/** Pending invites for one farm. orgId is in the filter, never applied after. */
export async function listPendingInvites(orgId: string): Promise<InviteDoc[]> {
  return (await invites())
    .find({ orgId, acceptedAt: { $exists: false }, revokedAt: { $exists: false } })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();
}

/**
 * Marks an invite used, and refuses to do it twice.
 *
 * The guard is in the filter rather than in a read-then-write, so two
 * acceptances racing on the same link cannot both succeed — one matches and
 * one does not, and Mongo decides which. A check-then-act here would be a real
 * race on a real link that two people were sent.
 */
export async function acceptInvite(hash: string, userId: string, at: Date): Promise<boolean> {
  const result = await (await invites()).updateOne(
    { _id: hash, acceptedAt: { $exists: false }, revokedAt: { $exists: false } },
    { $set: { acceptedAt: at, acceptedByUserId: userId } },
  );
  return result.modifiedCount === 1;
}

/**
 * Gives an invitation back, when the account it was spent on was never made.
 *
 * Spending before creating is the right order and stays: a crash between the
 * two must leave a link that no longer works rather than one that does. What it
 * cost was the other half — an invite burned with nothing to show for it, so
 * the farm has to issue a new link and the person is told their invitation is
 * no longer valid having done everything right. The window is not only the
 * email race the work list names; any transient database error opens it, and
 * that is far likelier.
 *
 * **Filtered on `acceptedByUserId`, which is the whole safety of it.** A
 * rollback that matched on the hash alone could take back somebody else's
 * successful acceptance — the one failure worse than the one being fixed. This
 * can only undo its own.
 */
export async function unacceptInvite(hash: string, userId: string): Promise<boolean> {
  const result = await (await invites()).updateOne(
    { _id: hash, acceptedByUserId: userId },
    { $unset: { acceptedAt: '', acceptedByUserId: '' } },
  );
  return result.modifiedCount === 1;
}

/** Revoking. Scoped by orgId so one farm cannot revoke another's invite. */
export async function revokeInvite(orgId: string, publicId: string, at: Date): Promise<boolean> {
  const result = await (await invites()).updateOne(
    { orgId, publicId, acceptedAt: { $exists: false }, revokedAt: { $exists: false } },
    { $set: { revokedAt: at } },
  );
  return result.modifiedCount === 1;
}

/**
 * Whether a presented email matches the one the invite was issued to.
 *
 * Constant-time, and that is not theatre: without it the comparison leaks
 * which prefix is right, and an attacker holding a leaked link could recover
 * the invited address a character at a time and then use it.
 */
export function emailMatches(invited: string, presented: string): boolean {
  const a = Buffer.from(normalizeEmail(invited), 'utf8');
  const b = Buffer.from(normalizeEmail(presented), 'utf8');
  // timingSafeEqual throws on a length mismatch, which is itself a leak of
  // length — hash both first so the comparison is always 32 bytes.
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
