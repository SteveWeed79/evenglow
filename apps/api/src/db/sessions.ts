import type { Collection } from 'mongodb';
import { db } from './client';

/**
 * Refresh-token storage.
 *
 * Not tenant-scoped, for the same reason identity is not: a refresh arrives
 * with nothing but a token, before any org is known. `scoped()` cannot serve
 * this path, so — like identity.ts — this module exposes narrow purpose-built
 * functions rather than a collection handle, and lives inside db/ so the lint
 * guard's exemption covers it.
 *
 * Tokens are stored as SHA-256 digests. A dump of this collection must not
 * hand anyone a working session.
 */

export interface RefreshTokenDoc {
  /** SHA-256 of the token, hex. Never the token itself. */
  _id: string;
  userId: string;
  /**
   * Every token descended from one sign-in shares a family. Reuse of an
   * already-rotated token revokes the whole family, because the only ways that
   * happens are a stolen token being replayed or a client bug — and both
   * deserve a forced sign-in rather than a shrug.
   */
  familyId: string;
  issuedAt: Date;
  expiresAt: Date;
  /** Set when this token was exchanged. A second exchange is the theft signal. */
  usedAt?: Date;
  revokedAt?: Date;
}

async function tokens(): Promise<Collection<RefreshTokenDoc>> {
  return (await db()).collection<RefreshTokenDoc>('refreshTokens');
}

export async function insertRefreshToken(doc: RefreshTokenDoc): Promise<void> {
  await (await tokens()).insertOne(doc);
}

export async function findRefreshToken(hash: string): Promise<RefreshTokenDoc | null> {
  return (await tokens()).findOne({ _id: hash });
}

/**
 * Marks a token used, but only if it was not used already.
 *
 * The conditional is the whole mechanism: two concurrent refreshes with the
 * same token race here, exactly one wins, and the loser is treated as reuse.
 * Checking then updating would let both through.
 */
export async function consumeRefreshToken(hash: string): Promise<boolean> {
  const result = await (
    await tokens()
  ).updateOne(
    { _id: hash, usedAt: { $exists: false }, revokedAt: { $exists: false } },
    { $set: { usedAt: new Date() } },
  );

  return result.modifiedCount === 1;
}

export async function revokeFamily(familyId: string): Promise<void> {
  await (await tokens()).updateMany(
    { familyId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await (await tokens()).updateMany(
    { userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
}
