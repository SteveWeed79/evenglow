import { createHash, randomInt } from 'node:crypto';
import type { Collection } from 'mongodb';
import { RESET_CODE_ALPHABET, RESET_CODE_LENGTH, RESET_MAX_ATTEMPTS } from '@steading/contracts';
import { db } from './client';

/**
 * The codes that let somebody back into an account.
 *
 * **Deliberately not tenant scoped**, for the reason `join-codes.ts` gives
 * about itself: this is used by a person with no session and therefore no
 * `orgId`, so `scoped()` cannot serve it. Same discipline in exchange — no
 * collection handle leaves this module, every function is purpose-built, and
 * there is no general-purpose query in it by design.
 *
 * Designed in `docs/PASSWORD-RECOVERY.md` §7. It follows `join-codes.ts` rather
 * than inventing a second idiom: CSPRNG mint, SHA-256 where the hash **is** the
 * `_id`, single use through a conditional update, and an expiry.
 */

export interface PasswordResetDoc {
  /** SHA-256 of the normalised code. The code itself is never stored. */
  _id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  /** Wrong guesses so far. At `RESET_MAX_ATTEMPTS` the row is dead. */
  attempts: number;
  /** Set on use. A replay finds it spent. */
  usedAt?: Date;
  /**
   * Set when a newer code replaced this one.
   *
   * **Superseded rather than deleted, and the first draft deleted.** Deleting
   * kept the table tidy and quietly broke the per-account limit above it:
   * `resetsSince` counts rows, and a delete-then-insert leaves exactly one row
   * however many times somebody asks — so the limit that exists to stop one
   * farmer's inbox being filled could never fire. Caught by the test for it.
   *
   * Keeping them is better anyway. Three an hour is the ceiling, the rows are
   * tiny, and a run of them is the record of somebody being locked out or
   * somebody else trying to lock them out — which is exactly what an operator
   * would want to be able to see.
   */
  supersededAt?: Date;
}

async function resets(): Promise<Collection<PasswordResetDoc>> {
  return (await db()).collection<PasswordResetDoc>('passwordResets');
}

/**
 * `randomInt` rather than `Math.random` or a modulo of random bytes — CSPRNG
 * backed and rejection sampling, so every character is uniform over the
 * alphabet. The same argument `mintJoinCode` makes, and it matters more here:
 * this code hands over an account.
 */
export function mintResetCode(): string {
  let out = '';
  for (let i = 0; i < RESET_CODE_LENGTH; i += 1) {
    out += RESET_CODE_ALPHABET[randomInt(RESET_CODE_ALPHABET.length)];
  }
  return out;
}

export function hashResetCode(normalised: string): string {
  return createHash('sha256').update(normalised).digest('hex');
}

/**
 * Retires whatever that account had live and installs a new one.
 *
 * One usable code per user, so somebody who taps twice has one working code and
 * it is the one in the newest email. **Marked superseded rather than deleted**
 * — see `supersededAt` for what deleting broke.
 *
 * Not atomic on its own, exactly as `replaceJoinCode` says of itself. Two mints
 * landing together could leave two usable codes, and the consequence is bounded
 * and acceptable here: both were minted for the same account by whoever
 * controls that inbox, both expire, and each dies on its own fifth wrong guess.
 * There is no lane to run this in the way the join-code route has one, because
 * the caller has no session to key one on.
 */
export async function replaceResetCode(doc: PasswordResetDoc): Promise<void> {
  const collection = await resets();
  await collection.updateMany(
    { userId: doc.userId, usedAt: { $exists: false }, supersededAt: { $exists: false } },
    { $set: { supersededAt: doc.createdAt } },
  );
  await collection.insertOne(doc);
}

/**
 * How many codes this account has been sent since a moment. The harassment
 * guard, and it counts *sends* rather than live rows — which is why the rows
 * have to survive being replaced.
 */
export async function resetsSince(userId: string, since: Date): Promise<number> {
  return (await resets()).countDocuments({ userId, createdAt: { $gte: since } });
}

export type ResetClaim =
  | { ok: true; userId: string }
  | { ok: false };

/**
 * Spends a code, once, and counts the guess when it fails.
 *
 * ## A conditional update, not a read-then-write
 *
 * The filter is the guard, so two people submitting the same code at the same
 * moment cannot both win — the same shape `redeemJoinCode` uses, and for the
 * same reason. The loser gets the identical refusal as somebody guessing.
 *
 * ## Counting the attempt is the more interesting half
 *
 * A wrong code has to be *charged* to the row it was aimed at, or the ceiling
 * means nothing. But a wrong code does not identify a row — that is the whole
 * point of hashing it — so there is nothing to increment. What is available is
 * the account, which the caller has already resolved from the email, so the
 * charge lands on that account's live code.
 *
 * That makes the ceiling per-account rather than per-guess-target, which is the
 * correct shape anyway: five wrong guesses at *this account's* recovery and the
 * code dies, whichever wrong strings were tried.
 */
export async function claimResetCode(
  hashed: string,
  userId: string,
  now: Date,
): Promise<ResetClaim> {
  const collection = await resets();

  const won = await collection.updateOne(
    {
      _id: hashed,
      userId,
      usedAt: { $exists: false },
      supersededAt: { $exists: false },
      expiresAt: { $gt: now },
      attempts: { $lt: RESET_MAX_ATTEMPTS },
    },
    { $set: { usedAt: now } },
  );

  if (won.modifiedCount === 1) return { ok: true, userId };

  /**
   * Charged to whatever this account currently has live.
   *
   * Bounded by the same filter the win uses, so a spent or expired row is not
   * dragged back to life by being guessed at, and a row already at the ceiling
   * is not incremented past it — the count is evidence, not a score.
   */
  await collection.updateOne(
    {
      userId,
      usedAt: { $exists: false },
      supersededAt: { $exists: false },
      expiresAt: { $gt: now },
      attempts: { $lt: RESET_MAX_ATTEMPTS },
    },
    { $inc: { attempts: 1 } },
  );

  return { ok: false };
}

/** For the isolation suite, which has to prove the code is never stored in the clear. */
export async function findResetByHash(hashed: string): Promise<PasswordResetDoc | null> {
  return (await resets()).findOne({ _id: hashed });
}
