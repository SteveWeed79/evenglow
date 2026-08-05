import { describe, expect, it } from 'vitest';
import {
  entitlementOf,
  heldLabel,
  HELD_LABEL,
  SUBSCRIPTION_STATES,
  subscriptionSchema,
  syncRefusalMessage,
  type Subscription,
} from '@steading/contracts';

/**
 * What a subscription buys, and what happens when it stops (D13).
 *
 * These rules are pure so they can be tested without a Play Console — which
 * matters more than it sounds, because **the states that actually hurt a farm
 * are the ones nobody can rehearse in a store sandbox.** A card that expires
 * in March, a hold that lifts a week later, a renewal notification that never
 * arrives. Every one of those is a branch below, and none of them can be
 * produced on demand from Google.
 *
 * Two failures matter and they are opposites:
 *
 * - **Sync stops when it should not**, and a farm concludes the app is broken
 *   over a card expiry it has not noticed.
 * - **Sync runs when it should not**, and a dropped webhook grants free
 *   service forever, silently, and undetectably from either end.
 */

const NOW = Date.parse('2026-05-15T09:00:00Z');
const DAY = 86_400_000;

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  state: 'active',
  expiresAt: NOW + 30 * DAY,
  source: 'play',
  ...over,
});

describe('who may sync', () => {
  it('lets a paid farm through', () => {
    expect(entitlementOf(sub(), NOW)).toEqual({ syncing: true, refusal: null });
  });

  /**
   * The ordinary free-tier farm, and it is not a problem — it is the product.
   * D13's free tier is the whole app on one phone.
   */
  it('holds an unsubscribed farm, and names it as that rather than as a fault', () => {
    expect(entitlementOf(undefined, NOW)).toEqual({ syncing: false, refusal: 'unsubscribed' });
    expect(entitlementOf(sub({ state: 'none' }), NOW).refusal).toBe('unsubscribed');
  });

  /**
   * The decision worth defending.
   *
   * A card expires and Google retries for up to thirty days. Stopping sync on
   * the first failed charge would cost a farm a month over an expiry date it
   * has not noticed — and it would be discovered as "the app is broken", not
   * as "my card bounced". The store is already chasing the payment.
   */
  it('keeps syncing through a grace period', () => {
    expect(entitlementOf(sub({ state: 'grace' }), NOW).syncing).toBe(true);
  });

  it('stops when it has lapsed', () => {
    expect(entitlementOf(sub({ state: 'lapsed' }), NOW)).toEqual({
      syncing: false,
      refusal: 'lapsed',
    });
  });

  /**
   * The webhook that never came.
   *
   * A stored state is only as fresh as the last notification, and notifications
   * are missed, delayed and delivered out of order. Trusting `active` against
   * a date three weeks gone is how a farm gets free service forever without
   * anybody being able to see it.
   */
  it('refuses an expiry in the past whatever the stored state claims', () => {
    for (const state of ['active', 'grace'] as const) {
      const stale = sub({ state, expiresAt: NOW - DAY });
      expect(entitlementOf(stale, NOW)).toEqual({ syncing: false, refusal: 'lapsed' });
    }
  });

  it('treats the expiry instant itself as past', () => {
    // A boundary that reads the other way would grant an extra tick of service
    // on every renewal, which is harmless — and it would also mean the two
    // sides of a comparison disagree about the same millisecond.
    expect(entitlementOf(sub({ expiresAt: NOW }), NOW).syncing).toBe(false);
    expect(entitlementOf(sub({ expiresAt: NOW + 1 }), NOW).syncing).toBe(true);
  });

  /**
   * A subscription with no expiry is trusted on its state alone. That is the
   * shape a rail without a period end would produce, and refusing it would
   * mean a farm that has paid cannot sync because a field was absent.
   */
  it('trusts the state when there is no expiry to check', () => {
    expect(entitlementOf({ state: 'active' }, NOW).syncing).toBe(true);
    expect(entitlementOf({ state: 'lapsed' }, NOW).syncing).toBe(false);
  });

  /** Every state is decided. A new one must not silently fall through to yes. */
  it('answers for every state there is', () => {
    for (const state of SUBSCRIPTION_STATES) {
      const answer = entitlementOf(sub({ state, expiresAt: NOW + DAY }), NOW);
      expect(typeof answer.syncing).toBe('boolean');
      expect(answer.syncing === (answer.refusal === null)).toBe(true);
    }
  });
});

describe('what it says about it', () => {
  /**
   * **Neither message says "pay".** One states where the records are, the
   * other states what changed. The offer lives one tap away on a screen
   * somebody chose to open — which is the whole difference between an app that
   * tells you something and one that nags.
   */
  it('never demands payment', () => {
    for (const refusal of ['unsubscribed', 'lapsed'] as const) {
      const said = syncRefusalMessage(refusal);

      /**
       * Verbs and prices, not the noun.
       *
       * A first pass banned the word "subscription" outright and failed on
       * *"kept on this phone since the subscription ended"* — which is the
       * sentence stating what changed, and a farm that is not told which thing
       * ended cannot act on it at all. The rule is about being asked for
       * something, so the check is for the ask: an imperative, a price, or a
       * clock.
       */
      expect(said).not.toMatch(/\bpay\b|\bsubscribe\b|upgrade|renew|\$|£|trial|expires? in/i);
    }
  });

  it('says nothing has been lost, because nothing has', () => {
    expect(syncRefusalMessage('lapsed')).toMatch(/nothing has been lost/i);
    expect(syncRefusalMessage('unsubscribed')).toMatch(/everything works/i);
  });
});

describe('the chip', () => {
  /**
   * The pill sits between a back arrow and a settings gear, beside labels of
   * eight to thirteen characters. A ticker was considered and refused: moving
   * text is the hardest thing to read at arm's length in sun with gloves, and
   * motion reads as *something is happening*, which is the opposite of what
   * this state means.
   */
  it('stays about as short as the labels it sits beside', () => {
    expect(HELD_LABEL.length).toBeLessThanOrEqual(14);
    // Four figures of records is a farm several seasons in — the longest this
    // realistically gets.
    expect(heldLabel(9999).length).toBeLessThanOrEqual(20);
  });

  /**
   * The number leads, because the number is the part that grows — A2.3's third
   * moment arriving on its own schedule rather than on a timer.
   */
  it('puts the count first once there is one worth showing', () => {
    expect(heldLabel(340)).toBe('340 on this phone');
  });

  it('drops the count on a farm that started this morning', () => {
    // "· 3" is noise. The chip should just say where things are.
    expect(heldLabel(3)).toBe(HELD_LABEL);
    expect(heldLabel(0)).toBe(HELD_LABEL);
    expect(heldLabel(24)).toBe(HELD_LABEL);
    expect(heldLabel(25)).toBe('25 on this phone');
  });

  it('never says waiting, because nothing is', () => {
    // `waiting` promises something is in flight. On an unsubscribed farm the
    // batch is not in flight, it is at rest.
    expect(heldLabel(340)).not.toMatch(/waiting|sending/i);
  });
});

describe('the stored shape', () => {
  it('takes what a rail can tell us and refuses what it cannot', () => {
    expect(subscriptionSchema.safeParse({ state: 'active' }).success).toBe(true);
    expect(subscriptionSchema.safeParse(sub()).success).toBe(true);
    expect(subscriptionSchema.safeParse({ state: 'nope' }).success).toBe(false);
    // One rail today. The field exists so a second is additive rather than a
    // migration.
    expect(subscriptionSchema.safeParse(sub({ source: 'stripe' as never })).success).toBe(false);
  });
});
