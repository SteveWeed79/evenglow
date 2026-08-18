import { createHash } from 'node:crypto';
import type { Collection } from 'mongodb';
import { db } from './client';

/**
 * Refresh tokens, stored hashed.
 *
 * Like `identity.ts`, this collection is deliberately NOT tenant-scoped: a
 * refresh happens before any orgId is established, so `scoped()` cannot serve
 * it. It follows the same shape in response — narrow purpose-built functions,
 * no collection handle leaves this module, and it lives inside `db/` so the
 * lint exemption covers it.
 *
 * That does mean a third collection the tenancy mechanism cannot structurally
 * protect. It is safe here for a specific reason rather than by assumption:
 * every row is keyed by the hash of a high-entropy secret, so there is no
 * query in this module that takes an org, a user, or anything else a caller
 * could widen. Presenting the token IS the lookup.
 */

export interface RefreshTokenDoc {
  /** SHA-256 of the token. The token itself is never stored. */
  _id: string;
  userId: string;
  /**
   * One login, one family. Rotation keeps the family; presenting a token that
   * has already been rotated revokes the whole of it.
   */
  familyId: string;
  issuedAt: Date;
  expiresAt: Date;
  /** Set when this token is exchanged. A second exchange is theft. */
  usedAt?: Date;
  revokedAt?: Date;
}

async function tokens(): Promise<Collection<RefreshTokenDoc>> {
  return (await db()).collection<RefreshTokenDoc>('refreshTokens');
}

/**
 * SHA-256, not argon2, and the difference is deliberate.
 *
 * Password hashing is slow on purpose because a password is low-entropy and
 * guessable. A refresh token is 256 bits from a CSPRNG; there is nothing to
 * brute-force, and putting argon2 on the refresh path would add hundreds of
 * milliseconds to every token exchange to defend against an attack that
 * cannot happen. What hashing buys here is that a database disclosure does
 * not hand over usable tokens.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function insertRefreshToken(doc: RefreshTokenDoc): Promise<void> {
  await (await tokens()).insertOne(doc);
}

export async function findRefreshToken(hash: string): Promise<RefreshTokenDoc | null> {
  return (await tokens()).findOne({ _id: hash });
}

/**
 * Marks a token exchanged, and reports whether this call is the one that did
 * it. The filter requires `usedAt` to be absent, so two concurrent refreshes
 * with the same token cannot both succeed — the loser sees a modifiedCount of
 * zero and is treated as reuse, which is what it is.
 */
export async function consumeRefreshToken(hash: string, at: Date): Promise<boolean> {
  const result = await (await tokens()).updateOne(
    { _id: hash, usedAt: { $exists: false }, revokedAt: { $exists: false } },
    { $set: { usedAt: at } },
  );
  return result.modifiedCount === 1;
}

export async function revokeFamily(familyId: string, at: Date): Promise<void> {
  await (await tokens()).updateMany(
    { familyId, revokedAt: { $exists: false } },
    { $set: { revokedAt: at } },
  );
}

/**
 * Signs an account out everywhere, on every device.
 *
 * **The first of the three writes a password reset makes**, and the one people
 * leave out. A reset is what somebody does when they think another person has
 * their password; leaving that person's session alive defeats the entire
 * exercise — they keep syncing on a refresh token the owner has never seen and
 * cannot name.
 *
 * Returns how many were killed, for the journal. A number greater than zero on
 * a reset nobody expected is the shape of an account that really was taken.
 */
export async function revokeAllForUser(userId: string, at: Date): Promise<number> {
  const result = await (await tokens()).updateMany(
    { userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: at } },
  );
  return result.modifiedCount;
}
