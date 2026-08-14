import { describe, expect, it } from 'vitest';
import { subscriptionFromPromo } from '@steading/contracts';
import { syncAccess } from '@steading/api/billing/access';
import { readEnv } from '@steading/api/env';
import type { OrgDoc } from '@steading/api/db/identity';

/**
 * One decision, two routes, and they used to disagree.
 *
 * `/billing` called `entitlementOf` directly under a comment promising *"the
 * same sentence the sync route sends, from the same function, so the account
 * screen and the chip cannot come to disagree."* The function was shared; the
 * three conditions in front of it were not.
 *
 * Caught on a handset with both screens open: **`Last sent Aug 10, 9:43 AM`**
 * on the Sync screen and **`nothing is sent anywhere`** on the account screen,
 * about the same minute, on a server with no Play configuration — which is
 * every self-hosted farm and the state this project is in today.
 *
 * A farm that catches the app contradicting itself about where its records are
 * has no reason to believe the next thing it says about them.
 */

const base = {
  AUTH_SECRET: 'a-test-secret-long-enough-for-hs256-abcdef',
  MONGODB_URI: 'mongodb://localhost:27017',
};

const ORG = '01J0000000000000000000000A';

const farm = (over: Partial<OrgDoc> = {}): OrgDoc => ({
  _id: ORG,
  name: 'Hollow Farm',
  createdAt: new Date(),
  ...over,
});

/** Enough Play config to turn the rail on. The value is never called here. */
const withPlay = {
  ...base,
  GOOGLE_PLAY_SERVICE_ACCOUNT: '{"client_email":"a@b.com","private_key":"k"}',
  GOOGLE_PLAY_PACKAGE: 'com.steading.app',
};

describe('a server that takes no payments', () => {
  it('asks nobody for anything', () => {
    // The self-hosted case, and the one the screenshots were taken on.
    expect(syncAccess(readEnv(base), farm())).toEqual({ syncing: true, refusal: null });
  });

  it('says the same about a farm it has never heard of', () => {
    expect(syncAccess(readEnv(base), null)).toEqual({ syncing: true, refusal: null });
  });

  /**
   * The exact contradiction, stated as a test: with no Play config the sync
   * route has always let a farm through, so nothing may report it as held.
   */
  it('never reports held on a server that cannot charge', () => {
    const lapsed = farm({ subscription: { state: 'lapsed', expiresAt: 1 } });
    expect(syncAccess(readEnv(base), lapsed).syncing).toBe(true);
  });
});

describe('a server that does take payments', () => {
  it('holds a farm that has not paid', () => {
    const answer = syncAccess(readEnv(withPlay), farm());
    expect(answer).toEqual({ syncing: false, refusal: 'unsubscribed' });
  });

  it('lets a farm named in the environment through', () => {
    const env = readEnv({ ...withPlay, FREE_SYNC_ORGS: ORG });
    expect(syncAccess(env, farm())).toEqual({ syncing: true, refusal: null });
  });

  /** The database half of the same grant — `pnpm farm:grant`, no restart. */
  it('lets a farm granted in the database through', () => {
    const granted = farm({ syncGranted: { at: new Date(), note: 'beta tester' } });
    expect(syncAccess(readEnv(withPlay), granted)).toEqual({ syncing: true, refusal: null });
  });

  it('still holds a lapsed farm that was never granted anything', () => {
    const lapsed = farm({ subscription: { state: 'lapsed', expiresAt: 1 } });
    expect(syncAccess(readEnv(withPlay), lapsed).refusal).toBe('lapsed');
  });

  it('lets a paid farm through', () => {
    const paid = farm({ subscription: { state: 'active', expiresAt: Date.now() + 86_400_000 } });
    expect(syncAccess(readEnv(withPlay), paid).syncing).toBe(true);
  });
});

/**
 * The open box, which is the state a public install page puts a server in.
 *
 * Reported from the box: *"our site for download is online all the time — if
 * someone finds it they get a free account?"* They did. The install page is
 * public by necessity, and the hostname is in Certificate Transparency logs the
 * moment a certificate is issued, so *if* somebody finds it is a matter of
 * when.
 *
 * `SYNC_REQUIRES_GRANT` is the answer, and where it sits is the argument: the
 * app stays free to install and a farm may keep its whole records on its own
 * handset for nothing. What needs granting is a copy on somebody else's server,
 * which is the part that costs — and D13 already says sync is the only thing
 * sold. This makes that true before Play exists rather than after.
 */
const guarded = { ...base, SYNC_REQUIRES_GRANT: '1' };

describe('a server that takes no payments and has been told to ask anyway', () => {
  it('holds a farm nobody has granted anything', () => {
    expect(syncAccess(readEnv(guarded), farm())).toEqual({
      syncing: false,
      refusal: 'unsubscribed',
    });
  });

  /** The stranger case exactly: an org this server has no document for. */
  it('holds a farm it has never heard of', () => {
    expect(syncAccess(readEnv(guarded), null).syncing).toBe(false);
  });

  it('lets a farm named in the environment through', () => {
    const env = readEnv({ ...guarded, FREE_SYNC_ORGS: ORG });
    expect(syncAccess(env, farm())).toEqual({ syncing: true, refusal: null });
  });

  it('lets a farm granted in the database through', () => {
    const granted = farm({ syncGranted: { at: new Date(), note: 'the tester' } });
    expect(syncAccess(readEnv(guarded), granted)).toEqual({ syncing: true, refusal: null });
  });

  /**
   * **The assertion the whole design rests on.** A promotion code does not
   * bypass the gate, it writes a subscription (A2.6) — so it has to arrive
   * through `entitlementOf` like a purchase would. If it did not, turning this
   * flag on would lock out the very people who had redeemed a code, which is
   * the opposite of what it is for.
   *
   * Built with the real `subscriptionFromPromo` rather than a hand-written
   * `{ state: 'active' }`, so a change to what redeeming writes fails here
   * rather than in somebody's barn.
   */
  it('lets a farm that redeemed a code through', () => {
    const redeemed = farm({ subscription: subscriptionFromPromo({ days: null }, Date.now()) });
    expect(syncAccess(readEnv(guarded), redeemed)).toEqual({ syncing: true, refusal: null });
  });

  it('holds a farm whose redeemed code has run out', () => {
    const expired = farm({ subscription: subscriptionFromPromo({ days: 30 }, Date.now() - 31 * 86_400_000) });
    expect(syncAccess(readEnv(guarded), expired).refusal).toBe('lapsed');
  });
});

describe('the flag itself', () => {
  /** Off is the default, because the default must keep a self-hoster working. */
  it('is off when unset', () => {
    expect(syncAccess(readEnv(base), farm()).syncing).toBe(true);
  });

  it.each(['', '0', 'no'])('is off for %o', (value) => {
    expect(syncAccess(readEnv({ ...base, SYNC_REQUIRES_GRANT: value }), farm()).syncing).toBe(true);
  });

  it.each(['1', 'true', 'TRUE'])('is on for %o', (value) => {
    expect(syncAccess(readEnv({ ...base, SYNC_REQUIRES_GRANT: value }), farm()).syncing).toBe(false);
  });

  /**
   * It changes nothing once Play is configured. The flag exists to bring the
   * gate forward, not to add a second one beside it — a farm that has paid must
   * sync whether or not this is set.
   */
  it('does not disturb a server that does take payments', () => {
    const paid = farm({ subscription: { state: 'active', expiresAt: Date.now() + 86_400_000 } });
    expect(syncAccess(readEnv({ ...withPlay, SYNC_REQUIRES_GRANT: '1' }), paid).syncing).toBe(true);
    expect(syncAccess(readEnv({ ...withPlay, SYNC_REQUIRES_GRANT: '1' }), farm()).syncing).toBe(false);
  });
});
