import { describe, expect, it } from 'vitest';
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
