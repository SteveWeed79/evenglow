import { createHash, randomInt } from 'node:crypto';
import type { Collection } from 'mongodb';
import type { Role } from '@steading/contracts';
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from '@steading/contracts';
import { db } from './client';

/**
 * Join codes — six characters, shown by the owner and typed by the hand
 * standing next to them (A2.5).
 *
 * Like `identity.ts`, `refresh-tokens.ts` and `invites.ts`, this collection is
 * deliberately NOT tenant-scoped: the whole point is that it is redeemed by
 * somebody who has no session and therefore no orgId yet, so `scoped()` cannot
 * serve the redeem path. It follows the same discipline as the other three —
 * no collection handle leaves this module, every function is purpose-built,
 * and every org-scoped read takes `orgId` as a required argument and puts it
 * in the filter. `tests/isolation` covers it.
 *
 * ## Why six characters is defensible here and is not in `invites.ts`
 *
 * That module says flatly that no rate limit makes a guessable invite safe,
 * and it is right about what it describes: a link that travels by text message
 * and then sits in a phone for a week. Every property that makes this
 * different is enforced below rather than hoped for.
 *
 * - **It exists only while somebody is holding their phone out.** Ten minutes,
 *   and the owner had to press a button to start them.
 * - **Single use.** Redemption is a conditional update, so exactly one caller
 *   can win — a second attempt with the same code finds it spent.
 * - **One live code per farm.** Minting replaces, so a farm cannot accumulate
 *   a drawer of valid codes it has forgotten about.
 * - **The redeem route is rate limited and fails closed**, like sign-in.
 *
 * 32^6 is about a billion. Against a ten-minute window, one live code per
 * farm, and a throttled route, the expected number of successful guesses is
 * far below one even for somebody spending the entire window on it. The long
 * invite token stays for anyone who would rather send a link.
 *
 * **Stored hashed**, for the same reason the invite token is: a database dump
 * or a stray log line must not hand somebody a working code. SHA-256 rather
 * than argon2 because the secret is high-entropy relative to its lifetime and
 * the redeem path must stay fast enough to rate limit meaningfully.
 */

export interface JoinCodeDoc {
  /** SHA-256 of the normalised code. The code itself is never stored. */
  _id: string;
  orgId: string;
  role: Role;
  createdByUserId: string;
  createdAt: Date;
  expiresAt: Date;
  /** Set on redemption. A second redemption is refused. */
  redeemedAt?: Date;
  redeemedByUserId?: string;
}

async function joinCodes(): Promise<Collection<JoinCodeDoc>> {
  return (await db()).collection<JoinCodeDoc>('joinCodes');
}

/**
 * `randomInt` rather than `Math.random` or a modulo of random bytes.
 *
 * Node's `randomInt` is CSPRNG-backed and rejection-samples, so every
 * character is uniform over the alphabet. A modulo would bias the first few
 * letters — a small bias, but this is a six-character secret and there is no
 * reason to give away any of it.
 */
export function mintJoinCode(): string {
  let out = '';
  for (let i = 0; i < JOIN_CODE_LENGTH; i += 1) {
    out += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
  }
  return out;
}

export function hashJoinCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Replaces whatever this farm had live.
 *
 * One code per farm at a time, so an owner who taps twice has one valid code
 * rather than two — and the one on screen is always the one that works.
 * Expired and redeemed rows are left alone: they are the audit trail of who
 * was let in and when.
 */
export async function replaceJoinCode(doc: JoinCodeDoc): Promise<void> {
  const collection = await joinCodes();
  await collection.deleteMany({ orgId: doc.orgId, redeemedAt: { $exists: false } });
  await collection.insertOne(doc);
}

export async function findJoinCode(hashed: string): Promise<JoinCodeDoc | null> {
  return (await joinCodes()).findOne({ _id: hashed });
}

/**
 * Spends a code, once.
 *
 * A conditional update rather than a read-then-write, so two people typing the
 * same code at the same moment cannot both get in. The filter is the guard;
 * the loser sees the same "no longer valid" answer as somebody guessing.
 */
export async function redeemJoinCode(
  hashed: string,
  userId: string,
  now: Date,
): Promise<boolean> {
  const result = await (await joinCodes()).updateOne(
    { _id: hashed, redeemedAt: { $exists: false }, expiresAt: { $gt: now } },
    { $set: { redeemedAt: now, redeemedByUserId: userId } },
  );
  return result.modifiedCount === 1;
}

/** The live code's expiry, for the screen that is showing it. Never the code. */
export async function liveJoinCodeExpiry(orgId: string, now: Date): Promise<Date | null> {
  const doc = await (await joinCodes()).findOne({
    orgId,
    redeemedAt: { $exists: false },
    expiresAt: { $gt: now },
  });
  return doc?.expiresAt ?? null;
}
