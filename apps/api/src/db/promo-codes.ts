import { createHash, randomInt } from 'node:crypto';
import type { Collection } from 'mongodb';
import type { PromoGrant } from '@homefarm/contracts';
import { JOIN_CODE_ALPHABET, PROMO_CODE_LENGTH } from '@homefarm/contracts';
import { db } from './client';

/**
 * Promotion codes — handed to a person, typed into the app, and worth a
 * subscription (D13).
 *
 * Like `identity.ts`, `join-codes.ts` and `invites.ts`, this collection is
 * deliberately NOT tenant-scoped: a code belongs to whoever issued it and is
 * redeemed against whichever farm the redeemer is signed into, so there is no
 * orgId to scope by until the moment of redemption. It keeps the same
 * discipline — no collection handle leaves this module, every function is
 * purpose-built, and the one org-scoped read takes `orgId` as an argument and
 * puts it in the filter.
 *
 * ## Why a code and not an environment variable
 *
 * The first version of this was `FREE_SYNC_ORGS`, a list of farm ids in the
 * server's environment, and the objection it was built to answer was real: an
 * authenticated route whose whole job is to switch off a paywall is the worst
 * thing in a service to get wrong.
 *
 * **A code is not a request, and that is the distinction the first design
 * missed.** Nobody asks for anything here; they present a secret they could
 * only have been given. That is the same shape as the join code this app has
 * had since A2.5, and it is why this is safe where "please grant me sync"
 * would not be. The env var stays as the break-glass that needs no database.
 *
 * ## Every property that makes a long-lived secret defensible
 *
 * `invites.ts` says flatly that no rate limit makes a guessable secret safe,
 * and a promotion code is exactly the shape it means: handed over, then left
 * in a message for a month. So none of the join code's mitigations are
 * borrowed. What is here instead:
 *
 * - **60 bits.** Twelve Crockford characters, `randomInt` per character —
 *   CSPRNG-backed and rejection-sampled, so no letter is likelier than
 *   another. The join code's six characters are a billion; this is a billion
 *   billion.
 * - **Redemption is authenticated.** A code grants a subscription to *a farm*,
 *   and a farm comes from a verified token — so an attacker needs an account
 *   before they can spend a guess. That is not a formality: it puts a rate
 *   limit and a sign-up in front of every attempt.
 * - **Bounded by count.** `maxRedemptions`, default one. A conditional update
 *   does the claiming, so concurrent callers cannot both win.
 * - **Bounded by time, twice.** The code can expire, and separately the grant
 *   it produces can — a code that never expires handing out a subscription
 *   that never expires is a thing you cannot take back.
 * - **Revocable.** `disabledAt`, because the honest answer to "that code got
 *   posted somewhere" is to turn it off rather than to hope.
 * - **Never minted by a route.** `pnpm promo:new` writes them. There is no
 *   path from the wire to a new code.
 *
 * **Stored hashed**, for the reason invites and join codes are: a database
 * dump or a stray log line must not hand somebody a working code. SHA-256
 * rather than argon2 because 60 bits of CSPRNG output has nothing to
 * brute-force offline, and the redeem path has to stay fast enough that rate
 * limiting it means something.
 */

export interface PromoCodeDoc {
  /** SHA-256 of the normalised code. The code itself is never stored. */
  _id: string;
  grant: PromoGrant;
  createdAt: Date;
  /** Absent means the code itself never expires. The grant still can. */
  expiresAt?: Date;
  /** Turned off by hand. Checked before anything else. */
  disabledAt?: Date;
  maxRedemptions: number;
  /**
   * Which farms have spent it, so a second device on the same farm is not a
   * second redemption — and so a list of codes can be read a year later and
   * say who used what.
   */
  redeemedBy: { orgId: string; userId: string; at: Date }[];
}

async function promoCodes(): Promise<Collection<PromoCodeDoc>> {
  return (await db()).collection<PromoCodeDoc>('promoCodes');
}

/**
 * `randomInt` rather than `Math.random` or a modulo of random bytes.
 *
 * CSPRNG-backed and rejection-sampling, so every character is uniform over the
 * alphabet. A modulo would bias the first few letters — small, and there is no
 * reason to give away any of a secret this is meant to be unguessable.
 */
export function mintPromoCode(): string {
  let code = '';
  for (let i = 0; i < PROMO_CODE_LENGTH; i += 1) {
    code += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

export function hashPromoCode(normalised: string): string {
  return createHash('sha256').update(normalised).digest('hex');
}

export async function createPromoCode(input: {
  code: string;
  grant: PromoGrant;
  maxRedemptions: number;
  expiresAt?: Date;
}): Promise<void> {
  await (await promoCodes()).insertOne({
    _id: hashPromoCode(input.code),
    grant: input.grant,
    createdAt: new Date(),
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    maxRedemptions: input.maxRedemptions,
    redeemedBy: [],
  });
}

/** Why a redemption did not happen. Never distinguished to the caller — see below. */
export type PromoRefusal = 'unknown' | 'spent' | 'expired' | 'already';

export type PromoResult =
  | { ok: true; grant: PromoGrant }
  | { ok: false; reason: PromoRefusal };

/**
 * Spends a code for one farm, or says why not.
 *
 * ## The claim is one conditional update
 *
 * Reading the document, checking the count and then writing would let two
 * callers both pass the check — and `maxRedemptions: 1` would hand out two
 * subscriptions. The filter carries every condition, so the database decides
 * and exactly one caller can win. That is the same argument `join-codes.ts`
 * makes about single use, and it is the only version that survives two phones
 * redeeming at once.
 *
 * ## `already` is not a failure
 *
 * A farm that redeems the same code twice — two hands, one code, or somebody
 * pressing the button again on bad signal — has not done anything wrong and
 * must not be told it has. It gets the grant it already had. This is the
 * idempotency the mutation queue insists on everywhere else, applied to the
 * one route where a retry would otherwise cost somebody a subscription.
 */
export async function redeemPromoCode(
  code: string,
  orgId: string,
  userId: string,
  now = new Date(),
): Promise<PromoResult> {
  const codes = await promoCodes();
  const _id = hashPromoCode(code);

  const found = await codes.findOne({ _id });
  if (found === null) return { ok: false, reason: 'unknown' };
  if (found.disabledAt !== undefined) return { ok: false, reason: 'expired' };
  if (found.expiresAt !== undefined && found.expiresAt <= now) {
    return { ok: false, reason: 'expired' };
  }

  // Already spent by this farm: hand back what it bought rather than refusing.
  if (found.redeemedBy.some((r) => r.orgId === orgId)) {
    return { ok: true, grant: found.grant };
  }

  const claimed = await codes.findOneAndUpdate(
    {
      _id,
      disabledAt: { $exists: false },
      'redeemedBy.orgId': { $ne: orgId },
      $expr: { $lt: [{ $size: '$redeemedBy' }, '$maxRedemptions'] },
    },
    { $push: { redeemedBy: { orgId, userId, at: now } } },
    { returnDocument: 'after' },
  );

  if (claimed === null) return { ok: false, reason: 'spent' };

  return { ok: true, grant: claimed.grant };
}
