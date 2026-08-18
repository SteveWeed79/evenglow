import type { Collection } from 'mongodb';
import {
  VERIFY_CODE_ALPHABET,
  VERIFY_CODE_LENGTH,
  VERIFY_MAX_ATTEMPTS,
} from '@steading/contracts';
import { hashCode, mintCode } from '../auth/one-time-code';
import { db } from './client';

/**
 * The codes that prove an address is readable by the account that claims it.
 *
 * **Its own collection, not a `purpose` column on `passwordResets`.** The two
 * codes must never be interchangeable: a code minted to confirm an address and
 * spent to reset a password is an account takeover, and the only thing standing
 * between those two tables sharing one collection and that outcome would be a
 * discriminator every query has to remember. Separate collections make it
 * structural — the reset query cannot reach a verification row because it is
 * not looking in the same place. That is the argument `_id` uniqueness makes
 * about org claims, applied one table over.
 *
 * **Deliberately not tenant scoped**, for the reason `password-resets.ts` gives
 * about itself — though the reason is different here and worth saying: this one
 * *is* reached with a session, so an `orgId` exists. It stays out of `scoped()`
 * anyway because it is keyed on a user and a user is not an org-scoped entity;
 * a farm has members, and a member's address is theirs. Same discipline in
 * exchange: no collection handle leaves this module and every function is
 * purpose-built.
 *
 * The shape follows `passwordResets` exactly — CSPRNG mint, SHA-256 as the
 * `_id`, single use through a conditional update, an attempt ceiling, and
 * supersede rather than delete. Deliberate: two flows a farmer experiences as
 * the same thing should not be two mechanisms somebody has to learn twice.
 */

export interface EmailVerificationDoc {
  /** SHA-256 of the normalised code. The code itself is never stored. */
  _id: string;
  userId: string;
  /**
   * The address this code was minted for.
   *
   * **Stored, and checked when the code is spent.** Without it a code sent to
   * the old address stays valid across a correction — somebody who mistyped,
   * received nothing, fixed the address and then found the first code in a
   * spam folder would confirm the wrong string. `changeEmail` supersedes live
   * codes for that reason too; this is the half that holds if the supersede
   * loses a race.
   */
  email: string;
  createdAt: Date;
  expiresAt: Date;
  /** Wrong guesses so far. At `VERIFY_MAX_ATTEMPTS` the row is dead. */
  attempts: number;
  usedAt?: Date;
  /** Set when a newer code, or a change of address, retired this one. */
  supersededAt?: Date;
}

async function verifications(): Promise<Collection<EmailVerificationDoc>> {
  return (await db()).collection<EmailVerificationDoc>('emailVerifications');
}

/** This flow's length and alphabet; the mechanism is `auth/one-time-code.ts`. */
export function mintVerifyCode(): string {
  return mintCode(VERIFY_CODE_LENGTH, VERIFY_CODE_ALPHABET);
}

export function hashVerifyCode(normalised: string): string {
  return hashCode(normalised);
}

/**
 * Retires whatever that account had live and installs a new one.
 *
 * Superseded rather than deleted, for the reason `password-resets.ts` records
 * at length: the per-account send limit counts rows, and deleting the previous
 * one leaves exactly one however many times somebody asks — which is the limit
 * silently never firing.
 */
export async function replaceVerifyCode(doc: EmailVerificationDoc): Promise<void> {
  const collection = await verifications();
  await collection.updateMany(
    { userId: doc.userId, usedAt: { $exists: false }, supersededAt: { $exists: false } },
    { $set: { supersededAt: doc.createdAt } },
  );
  await collection.insertOne(doc);
}

/**
 * Retires every live code for an account without minting a replacement.
 *
 * Called when the address moves. A code in flight was minted for a string this
 * account no longer uses, and leaving it live would let the previous address
 * confirm the new one.
 */
export async function retireVerifyCodes(userId: string, at: Date): Promise<void> {
  await (await verifications()).updateMany(
    { userId, usedAt: { $exists: false }, supersededAt: { $exists: false } },
    { $set: { supersededAt: at } },
  );
}

/** How many codes this account has been sent since a moment. */
export async function verifySendsSince(userId: string, since: Date): Promise<number> {
  return (await verifications()).countDocuments({ userId, createdAt: { $gte: since } });
}

export type VerifyClaim = { ok: true } | { ok: false };

/**
 * Spends a code, once, and charges the guess when it fails.
 *
 * The same conditional-update shape `claimResetCode` uses and for the same
 * reasons — the filter is the guard, so two submissions of one code cannot both
 * win, and a wrong guess is charged to whatever this account currently has live
 * because a wrong code identifies no row.
 *
 * `email` is in the filter as well as `userId`: a code is minted for one
 * address, and an account whose address moved must not be able to spend it.
 */
export async function claimVerifyCode(
  hashed: string,
  userId: string,
  email: string,
  now: Date,
): Promise<VerifyClaim> {
  const collection = await verifications();

  const won = await collection.updateOne(
    {
      _id: hashed,
      userId,
      email,
      usedAt: { $exists: false },
      supersededAt: { $exists: false },
      expiresAt: { $gt: now },
      attempts: { $lt: VERIFY_MAX_ATTEMPTS },
    },
    { $set: { usedAt: now } },
  );

  if (won.modifiedCount === 1) return { ok: true };

  await collection.updateOne(
    {
      userId,
      usedAt: { $exists: false },
      supersededAt: { $exists: false },
      expiresAt: { $gt: now },
      attempts: { $lt: VERIFY_MAX_ATTEMPTS },
    },
    { $inc: { attempts: 1 } },
  );

  return { ok: false };
}

/** For the isolation suite, which proves the code is never stored in the clear. */
export async function findVerifyByHash(hashed: string): Promise<EmailVerificationDoc | null> {
  return (await verifications()).findOne({ _id: hashed });
}
