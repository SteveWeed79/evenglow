import { z } from 'zod';

/**
 * What a subscription buys, and what happens when it stops (D13).
 *
 * **Free forever on one device. Paid when the server holds your data.** The
 * free tier is not a crippled one — it is the whole app, every feature, on one
 * phone, and it costs nothing to serve because nothing is synced. So the line
 * is neither a feature split nor a countdown: it is the point where a cost is
 * actually incurred.
 *
 * > The only thing that costs money to provide is the only thing worth
 * > charging for.
 *
 * Everything in this file is pure. The rail — Google Play — is an adapter on
 * the server, and these rules are testable without a Play Console, which
 * matters because **the states that hurt a farm are the ones nobody can
 * rehearse in a store sandbox**: a card that expires in March, a hold that
 * lifts a week later, a refund.
 */

/**
 * The states a farm can be in, mapped down from Play's larger set.
 *
 * Deliberately fewer than Play has. Play distinguishes paused, on hold,
 * canceled-but-still-entitled and expired; a farm needs to know only whether
 * its records are reaching the server, and whether anything is required of it.
 * Every extra state is a branch in the UI that says the same sentence.
 */
export const SUBSCRIPTION_STATES = [
  /** Never subscribed. The ordinary free-tier farm, and not a problem. */
  'none',
  /** Paid and current. */
  'active',
  /**
   * Payment failed and the store is retrying.
   *
   * **Still entitled**, deliberately — see `entitlementOf`.
   */
  'grace',
  /** It has ended: expired, on hold past its grace, refunded, or cancelled. */
  'lapsed',
] as const;

export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

export const subscriptionSchema = z.object({
  state: z.enum(SUBSCRIPTION_STATES),
  /** Unix ms. When the current paid period ends, or when the grace runs out. */
  expiresAt: z.number().int().optional(),
  /** Which rail sold it. One today; the field exists so a second is additive. */
  source: z.literal('play').optional(),
  /** Play's own product id, kept for reconciling against a console. */
  productId: z.string().max(120).optional(),
  updatedAt: z.number().int().optional(),
});

export type Subscription = z.infer<typeof subscriptionSchema>;

/**
 * Why sync is or is not running, in the app's own words.
 *
 * A reason rather than a boolean, because the *sentence* is the feature. A
 * farm that sees nothing sending needs to know which of three things is true —
 * it never paid, its card failed, or the app is broken — and those get very
 * different responses from a person.
 */
export const SYNC_REFUSALS = ['unsubscribed', 'lapsed'] as const;
export type SyncRefusal = (typeof SYNC_REFUSALS)[number];

export interface Entitlement {
  /** Whether the server will accept this farm's mutations. */
  syncing: boolean;
  /** Set when it will not. Null while syncing. */
  refusal: SyncRefusal | null;
}

/**
 * Whether this farm's records may reach the server.
 *
 * ## Grace is entitled, and that is the decision worth defending
 *
 * A card expires in March. Google retries for up to thirty days. If sync
 * stopped on the first failed charge, a farm would lose a month of syncing
 * over an expiry date it has not noticed yet — and would discover it as
 * "the app is broken", not as "my card bounced". The store is already
 * chasing the payment; the app does not need to hold a farm's records hostage
 * to help.
 *
 * The cost of being wrong in this direction is thirty days of storage for a
 * farm that pays under a dime a year to serve. The cost of being wrong the
 * other way is the farm.
 *
 * ## Lapsed stops sync and touches nothing
 *
 * **No records are deleted, ever, on either side.** The roadmap already
 * refuses timed deletion of a farm's history and the reasoning holds harder
 * here: a lapse is a payment event, and answering it by destroying records
 * would make the app the thing a farm has to protect its data *from*.
 *
 * The local database is untouched by definition — it is on the handset, and
 * "free forever on one device" is exactly what a lapsed farm falls back to.
 * The queue keeps accumulating rather than dropping, so a farm that resubscribes
 * flushes everything it recorded meanwhile.
 */
export function entitlementOf(
  subscription: Subscription | undefined,
  now: number,
): Entitlement {
  if (subscription === undefined || subscription.state === 'none') {
    return { syncing: false, refusal: 'unsubscribed' };
  }

  if (subscription.state === 'lapsed') return { syncing: false, refusal: 'lapsed' };

  /**
   * An expiry in the past overrides the stored state.
   *
   * The state is only as fresh as the last store notification, and a webhook
   * can be missed, delayed, or arrive out of order. Trusting `state: 'active'`
   * against a date three weeks gone would mean a dropped notification granting
   * a farm free service forever — silently, and undetectably from either end.
   *
   * The reverse mistake is the safe one: an expiry that has passed while the
   * renewal notification is in flight costs a farm minutes of sync, and the
   * next notification restores it.
   */
  if (subscription.expiresAt !== undefined && subscription.expiresAt <= now) {
    return { syncing: false, refusal: 'lapsed' };
  }

  // Active, or in grace and still entitled.
  return { syncing: true, refusal: null };
}

/**
 * What the app says when the server will not take a batch.
 *
 * Named for the refusal it describes rather than `refusalMessage`, which
 * `membership.ts` already owns for a different kind of no. Two functions with
 * one name across one barrel export is a collision the compiler catches; two
 * *concepts* with one name is one it does not.
 *
 * Written here rather than on the client because the server sends it and the
 * client shows it — one sentence, one place, and no chance of the two
 * disagreeing about what happened.
 *
 * **Neither of these says "pay".** The first states where the records are; the
 * second states what changed. The offer lives one tap away on a screen
 * somebody chose to open, which is the whole difference between an app that
 * tells you something and one that nags.
 */
export function syncRefusalMessage(refusal: SyncRefusal): string {
  switch (refusal) {
    case 'unsubscribed':
      return 'Kept on this phone. Everything works; nothing is sent anywhere.';
    case 'lapsed':
      return 'Kept on this phone since the subscription ended. Nothing has been lost.';
  }
}

/**
 * The chip's own words (UX-SPEC R6 — the queue is visible and calm).
 *
 * **`waiting` would be a lie here.** It promises something is happening, and
 * on an unsubscribed farm nothing is: the batch is not in flight, it is at
 * rest. Naming where the records *are* is both true and the honest sell —
 * see `heldLabel`.
 */
export const HELD_LABEL = 'On this phone';

/**
 * The chip's label, and the reason this is not a nag.
 *
 * **The number leads, because the number is the part that grows.** A farm
 * three weeks in sees a small one and shrugs. A farm two seasons in sees a big
 * one, and that is A2.3's third moment — *enough data to hurt losing* —
 * arriving on its own schedule rather than on a timer.
 *
 * The app never raises its voice; the arithmetic does it. No banner, no badge,
 * no modal, no countdown. If a farm never taps the chip it uses the whole app
 * free forever, which is what D13 promised.
 *
 * ## Why it is this short
 *
 * The pill sits between a back arrow and a settings gear on a phone header,
 * and the labels it lives beside are eight to thirteen characters — `1
 * waiting`, `2 need a look`, `Not set up`. "Kept on this phone · 340" is
 * twenty-four and would truncate or force the pill to grow into the title.
 *
 * **A ticker was considered and refused.** Scrolling text is the hardest thing
 * to read at arm's length in sun with gloves on, it turns a glanceable status
 * into one you have to wait for, and motion in the corner of the eye reads as
 * *something is happening* — the exact opposite of what this state means. The
 * sentence a farm needs is one tap away in Diagnostics; the pill only has to
 * say where the records are and how many.
 *
 * Below the floor the count is dropped rather than shown, because "· 3" is
 * noise on a farm that started this morning.
 */
export function heldLabel(count: number, floor = 25): string {
  return count < floor ? HELD_LABEL : `${count} on this phone`;
}
