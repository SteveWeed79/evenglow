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
 * Why a consume did not happen, which used to be one answer for two events.
 *
 * - `consumed` — this call marked it, and may issue.
 * - `already-used` — another exchange of the same token won by microseconds.
 *   The concurrent case the reuse grace window exists for.
 * - `revoked` — a revocation landed on this token between it being read and
 *   this update. Not a race to lose; a session that has been ended.
 */
export type ConsumeOutcome = 'consumed' | 'already-used' | 'revoked';

/**
 * Marks a token exchanged, and says which of the three happened.
 *
 * **This returned a boolean, and `rotateSession` read `false` as "another
 * exchange won the race".** The filter matches on `revokedAt` as well as
 * `usedAt`, so a password reset or a member removal landing inside the exchange
 * produced exactly the same `false` — and the caller, reading it as the benign
 * concurrent case, went on to issue a fresh 90-day token into a family that had
 * just been revoked. The one moment a revocation most needs to win is the one
 * where a session is being renewed.
 *
 * The second read is what tells them apart, and it is safe because `revokedAt`
 * is **monotonic**: `revokeFamily` and `revokeAllForUser` only ever `$set` it,
 * and nothing in this service clears it. So a row that reads revoked here is
 * revoked, whatever order the two writes landed in. Where the read is late
 * enough to see a revocation that arrived after a lost race, the answer is
 * `revoked` rather than `already-used` — which refuses a token that was about
 * to be refused anyway, and errs toward ending the session.
 */
export async function consumeRefreshToken(hash: string, at: Date): Promise<ConsumeOutcome> {
  const result = await (await tokens()).updateOne(
    { _id: hash, usedAt: { $exists: false }, revokedAt: { $exists: false } },
    { $set: { usedAt: at } },
  );
  if (result.modifiedCount === 1) return 'consumed';

  const row = await (await tokens()).findOne({ _id: hash }, { projection: { revokedAt: 1 } });
  return consumeOutcome(false, row?.revokedAt);
}

/**
 * The three-way reading, as a pure function.
 *
 * Pulled out for the reason `reuseVerdict` was, and its note says it best:
 * *"the arithmetic that decides whether a farm keeps its session lives where an
 * ordinary unit test can reach it, and only the wiring depends on CI."*
 * `rotateSession` needs a real mongod and this machine cannot get one, and the
 * previous round of session work failed exactly by letting CI be the first
 * thing to run it.
 *
 * The rule is one line and it is the whole finding: a consume that did not
 * happen is `revoked` when the row is revoked, and only otherwise a race.
 */
export function consumeOutcome(matched: boolean, revokedAt: Date | undefined): ConsumeOutcome {
  if (matched) return 'consumed';
  return revokedAt === undefined ? 'already-used' : 'revoked';
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
