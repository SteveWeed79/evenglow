import { describe, expect, it } from 'vitest';
import {
  entitlementOf,
  formatPromoCode,
  normalizeJoinCode,
  PROMO_CODE_LENGTH,
  promoGrantSchema,
  subscriptionFromPromo,
  heldLabel,
  HELD_LABEL,
  SUBSCRIPTION_STATES,
  subscriptionSchema,
  syncRefusalMessage,
  type Subscription,
} from '@steading/contracts';
import { readPlayConfig, subscriptionFrom } from '@steading/api/billing/play';
import { readEnv } from '@steading/api/env';

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

/**
 * Google's states, mapped down to the four a farm needs.
 *
 * Tested against every state Google documents, because **none of them can be
 * produced on demand in a store sandbox.** A card that expires in March, a
 * hold that lifts a week later, a plan change mid-period — the mapping is
 * where the judgement about each of those lives, and this is the only place it
 * can be checked before a real farm meets it.
 */
describe('what Google says, and what it means', () => {
  const purchase = (state: string, expiry?: string) => ({
    subscriptionState: state,
    lineItems: [{ productId: 'steading.year', ...(expiry === undefined ? {} : { expiryTime: expiry }) }],
  });

  it('treats an active subscription as active', () => {
    expect(subscriptionFrom(purchase('SUBSCRIPTION_STATE_ACTIVE'), NOW).state).toBe('active');
  });

  /**
   * The one that looks wrong and is not.
   *
   * A farm that turns off auto-renew in October has paid through to its expiry
   * and is owed the service until then — and Google reports it as canceled for
   * that whole period. Treating it as lapsed would cut a farm off from
   * something it has already paid for, which is the most indefensible bug this
   * mapping could have.
   */
  it('keeps a cancelled subscription entitled until it expires', () => {
    const cancelled = subscriptionFrom(
      purchase('SUBSCRIPTION_STATE_CANCELED', new Date(NOW + 60 * DAY).toISOString()),
      NOW,
    );

    expect(cancelled.state).toBe('active');
    expect(entitlementOf(cancelled, NOW).syncing).toBe(true);
    // And it does stop, on the day it was paid up to.
    expect(entitlementOf(cancelled, NOW + 61 * DAY).syncing).toBe(false);
  });

  it('separates grace from hold, because they are entitled differently', () => {
    // Grace is Google retrying the payment; hold is what happens after the
    // retries fail.
    expect(subscriptionFrom(purchase('SUBSCRIPTION_STATE_IN_GRACE_PERIOD'), NOW).state).toBe('grace');
    expect(subscriptionFrom(purchase('SUBSCRIPTION_STATE_ON_HOLD'), NOW).state).toBe('lapsed');
  });

  it('treats paused, expired and pending as not entitled', () => {
    for (const state of ['PAUSED', 'EXPIRED', 'PENDING', 'UNSPECIFIED']) {
      expect(subscriptionFrom(purchase(`SUBSCRIPTION_STATE_${state}`), NOW).state).toBe('lapsed');
    }
  });

  /**
   * Google adds states. A default of `active` would mean a state nobody has
   * read about yet silently granting service; a default of `lapsed` means it
   * silently withholds it. The second is visible — a farm complains — and the
   * first is not.
   */
  it('treats a state it has never heard of as not entitled', () => {
    expect(subscriptionFrom(purchase('SUBSCRIPTION_STATE_SOMETHING_NEW'), NOW).state).toBe('lapsed');
    expect(subscriptionFrom({ nonsense: true }, NOW).state).toBe('lapsed');
    expect(subscriptionFrom(null, NOW).state).toBe('lapsed');
  });

  it('takes the furthest expiry when a plan change shows two', () => {
    const soon = new Date(NOW + 5 * DAY).toISOString();
    const later = new Date(NOW + 40 * DAY).toISOString();

    const changed = subscriptionFrom(
      {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        lineItems: [{ expiryTime: soon }, { expiryTime: later }],
      },
      NOW,
    );

    // Cutting a farm off at the earlier of the two would end service it has
    // paid for.
    expect(changed.expiresAt).toBe(Date.parse(later));
  });

  it('records the rail, so a second one is additive rather than a migration', () => {
    expect(subscriptionFrom(purchase('SUBSCRIPTION_STATE_ACTIVE'), NOW)).toMatchObject({
      source: 'play',
      productId: 'steading.year',
      updatedAt: NOW,
    });
  });
});

describe('reading the Play credentials', () => {
  const key = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n';

  it('is absent rather than broken when the server takes no payments', () => {
    // A supported state: the billing routes answer 501 and every farm stays on
    // the free tier, which is what the app does today.
    expect(readPlayConfig(undefined, 'com.steading.app')).toBeNull();
    expect(readPlayConfig(JSON.stringify({ client_email: 'a@b.test', private_key: key }), undefined)).toBeNull();
  });

  it('unescapes a key pasted through a shell', () => {
    const config = readPlayConfig(
      JSON.stringify({ client_email: 'a@b.test', private_key: key.replace(/\n/g, '\\n') }),
      'com.steading.app',
    );
    expect(config?.privateKey).toContain('\n');
    expect(config?.privateKey).not.toContain('\\n');
  });

  it('names the field and never the value when it is malformed', () => {
    // This object holds a private key. An error message that quoted it would
    // put it in a log.
    expect(() => readPlayConfig('{"client_email":"a@b.test"}', 'com.steading.app')).toThrow(
      /client_email and private_key/,
    );
    expect(() => readPlayConfig('not json', 'com.steading.app')).toThrow(/valid JSON/);

    try {
      readPlayConfig('{"private_key":"SECRETVALUE"}', 'com.steading.app');
    } catch (error) {
      expect((error as Error).message).not.toContain('SECRETVALUE');
    }
  });
});

/**
 * Free sync for a farm the server names (D13).
 *
 * Testers, and the people building this. **Configuration rather than a route**
 * — a grant that can be requested is a grant that can be requested by anybody,
 * and an authenticated endpoint whose whole job is to switch off a paywall is
 * the worst thing in the service to get wrong (invariant 10).
 */
describe('the farms that are never asked', () => {
  const base = {
    AUTH_SECRET: 'a-test-secret-long-enough-for-hs256-abcdef',
    MONGODB_URI: 'mongodb://localhost:27017',
  };
  const ORG = '01J0000000000000000000000A';
  const OTHER = '01J0000000000000000000000B';

  it('is empty unless somebody set it, which is the normal state', () => {
    expect(readEnv(base).freeSyncOrgs.size).toBe(0);
  });

  it('grants the farms it names and nobody else', () => {
    const env = readEnv({ ...base, FREE_SYNC_ORGS: `${ORG},${OTHER}` });

    expect(env.freeSyncOrgs.has(ORG)).toBe(true);
    expect(env.freeSyncOrgs.has(OTHER)).toBe(true);
    expect(env.freeSyncOrgs.has('01J0000000000000000000000C')).toBe(false);
  });

  it('forgives whitespace, because this is pasted from a phone screen', () => {
    expect(readEnv({ ...base, FREE_SYNC_ORGS: ` ${ORG} , ${OTHER} ` }).freeSyncOrgs.size).toBe(2);
  });

  /**
   * A typo here would be a farm still getting 402s while somebody was certain
   * they had been granted access — a support conversation that starts three
   * days late. Fail at startup with the value in the message instead.
   */
  it('refuses anything that is not a farm id, rather than skipping it', () => {
    expect(() => readEnv({ ...base, FREE_SYNC_ORGS: 'steve@example.test' })).toThrow(/farm ids/);
    expect(() => readEnv({ ...base, FREE_SYNC_ORGS: `${ORG},nope` })).toThrow(/nope/);
  });
});

/**
 * Promotion codes (D13) — the pure half.
 *
 * **A code writes a subscription; it does not punch a hole in the gate.** That
 * is the whole design, and it is why there is nothing to test in `sync.ts`:
 * `entitlementOf` still decides, an expiry still overrides a stored state, and
 * the route that refuses a lapsed farm never learns promotions exist. A bypass
 * would have been fewer lines and a second code path through the one decision
 * money depends on.
 */
describe('what a code is worth', () => {
  const NOW = Date.parse('2026-05-15T09:00:00Z');

  it('is a real subscription, indistinguishable to everything downstream', () => {
    const granted = subscriptionFromPromo({ days: 365 }, NOW);

    expect(entitlementOf(granted, NOW)).toEqual({ syncing: true, refusal: null });
    expect(granted.source).toBe('promo');
  });

  /**
   * The clock starts at redemption, not at minting. A code written in March
   * and used in June is worth the same year either way — otherwise a code
   * sitting in a message quietly loses value, which is not what anybody means
   * by "a year".
   */
  it('counts its days from when it was used', () => {
    const granted = subscriptionFromPromo({ days: 30 }, NOW);
    expect(granted.expiresAt).toBe(NOW + 30 * 86_400_000);

    const later = subscriptionFromPromo({ days: 30 }, NOW + 60 * 86_400_000);
    expect(later.expiresAt).toBe(NOW + 90 * 86_400_000);
  });

  /** Forever is a real answer, and it is what the people who build this get. */
  it('can be forever, and forever has no expiry to drift past', () => {
    const granted = subscriptionFromPromo({ days: null }, NOW);

    expect(granted.expiresAt).toBeUndefined();
    expect(entitlementOf(granted, NOW + 10_000 * 86_400_000).syncing).toBe(true);
  });

  /**
   * The safety this inherits for free by being a subscription rather than a
   * bypass: a granted year still ends, and it ends through the same code path
   * that ends a bought one.
   */
  it('lapses when its days run out, like anything else', () => {
    const granted = subscriptionFromPromo({ days: 7 }, NOW);
    const after = NOW + 8 * 86_400_000;

    expect(entitlementOf(granted, after)).toEqual({ syncing: false, refusal: 'lapsed' });
  });
});

describe('the code itself', () => {
  /**
   * Sized against `invites.ts`, not against the join code.
   *
   * A join code lives ten minutes while somebody holds their phone out, and
   * six characters is defensible for exactly that. A promotion code is handed
   * over and sits in a message for a month, which is the shape `invites.ts`
   * says no rate limit can make safe if it is guessable.
   */
  it('is long enough to survive sitting in a message for a month', () => {
    // 32 characters of Crockford is 5 bits each: 12 × 5 = 60.
    expect(PROMO_CODE_LENGTH * 5).toBeGreaterThanOrEqual(60);
    // A billion billion, against the join code's billion.
    expect(32 ** PROMO_CODE_LENGTH).toBeGreaterThan(1e17);
  });

  it('is grouped so it can be read down a phone line', () => {
    expect(formatPromoCode('4F7KM2Q9XT3B')).toBe('4F7K-M2Q9-XT3B');
  });

  /**
   * The same courtesy the join code extends: somebody reading a code off a
   * screen and typing O for 0 has not made a mistake worth refusing.
   */
  it('is understood however the ambiguous letters were typed', () => {
    expect(normalizeJoinCode('4f7k-m2q9-xt3b')).toBe('4F7KM2Q9XT3B');
    expect(normalizeJoinCode('OI L')).toBe('011');
  });

  it('refuses a grant that is not a whole number of days', () => {
    expect(promoGrantSchema.safeParse({ days: 0 }).success).toBe(false);
    expect(promoGrantSchema.safeParse({ days: -5 }).success).toBe(false);
    expect(promoGrantSchema.safeParse({ days: 1.5 }).success).toBe(false);
    expect(promoGrantSchema.safeParse({ days: null }).success).toBe(true);
  });
});
