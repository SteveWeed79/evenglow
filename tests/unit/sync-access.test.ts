import { describe, expect, it } from 'vitest';
import { SYNC_REFUSALS, subscriptionFromPromo } from '@steading/contracts';
import { type FarmSyncState, farmSyncState, syncAccess } from '@steading/api/billing/access';
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
  GOOGLE_PLAY_PACKAGE: 'dev.swbuild.homefarm',
};

describe('a server deliberately left open', () => {
  it('asks nobody for anything', () => {
    // The self-hosted case, and the one the screenshots were taken on. It needs
    // saying out loud now: `SYNC_OPEN_TO_ALL` is what makes this the answer.
    expect(syncAccess(readEnv(opened), farm())).toEqual({ syncing: true, refusal: null });
  });

  it('says the same about a farm it has never heard of', () => {
    expect(syncAccess(readEnv(opened), null)).toEqual({ syncing: true, refusal: null });
  });

  /**
   * The contradiction this file was written for: an open server has always let
   * a farm through, so nothing may report it as held. Still true, now that
   * being open is a choice rather than an accident.
   */
  it('never reports held on a server that cannot charge', () => {
    const lapsed = farm({ subscription: { state: 'lapsed', expiresAt: 1 } });
    expect(syncAccess(readEnv(opened), lapsed).syncing).toBe(true);
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
const guarded = base; // closed is the default now
const opened = { ...base, SYNC_OPEN_TO_ALL: '1' };

describe('a server that takes no payments, which now asks by default', () => {
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
  /**
   * **Closed is what you get by doing nothing**, and that is the correction.
   * This was a `SYNC_REQUIRES_GRANT` flag defaulting off, which made the gate
   * possible rather than actual — a hole stays open when closing it is a step
   * somebody has to remember.
   */
  it('is closed when unset', () => {
    expect(syncAccess(readEnv(base), farm()).syncing).toBe(false);
  });

  it.each(['', '0', 'no'])('stays closed for %o', (value) => {
    expect(syncAccess(readEnv({ ...base, SYNC_OPEN_TO_ALL: value }), farm()).syncing).toBe(false);
  });

  it.each(['1', 'true', 'TRUE'])('opens for %o', (value) => {
    expect(syncAccess(readEnv({ ...base, SYNC_OPEN_TO_ALL: value }), farm()).syncing).toBe(true);
  });

  /**
   * It changes nothing once Play is configured. The flag exists to bring the
   * gate forward, not to add a second one beside it — a farm that has paid must
   * sync whether or not this is set.
   */
  it('does not disturb a server that does take payments', () => {
    const paid = farm({ subscription: { state: 'active', expiresAt: Date.now() + 86_400_000 } });
    expect(syncAccess(readEnv({ ...withPlay, SYNC_OPEN_TO_ALL: '1' }), paid).syncing).toBe(true);
    expect(syncAccess(readEnv({ ...withPlay, SYNC_OPEN_TO_ALL: '1' }), farm()).syncing).toBe(false);
  });
});

/**
 * The floor a server may set on how old a client may be ([23], [24]).
 *
 * Here rather than in a route test because this is the decision; the route is
 * three lines that read a header and send a 426. What matters is that the
 * default refuses nobody, since every server today runs with it.
 */
describe('the minimum client version', () => {
  it('is absent by default, which is every server today', () => {
    expect(readEnv(base).minimumClientVersion).toBeNull();
  });

  it('carries what was set, and an empty setting stays absent', () => {
    expect(readEnv({ ...base, MINIMUM_CLIENT_VERSION: '0.1.18' }).minimumClientVersion).toBe(
      '0.1.18',
    );
    expect(readEnv({ ...base, MINIMUM_CLIENT_VERSION: '' }).minimumClientVersion).toBeNull();
  });
});

/**
 * The same decision, told apart rather than collapsed — and held to the first.
 *
 * `syncAccess` answers *may this farm write*, which is one bit. An operations
 * page needs the four yeses apart, because "comped because I put them in an env
 * var" and "paying" are the same to the wire and nothing like each other on a
 * page about subscribers. `farmSyncState` splits them, and splitting means a
 * second copy of the branch order.
 *
 * **So the two are pinned to each other here.** The states walked below are
 * every way through and every way not, and each one asserts that
 * `farmSyncState` names a refusal exactly when `syncAccess` refuses. Reorder
 * either function and this fails, rather than the page quietly describing a
 * farm that is not the farm.
 */
describe('what an operator is shown about a farm', () => {
  const REFUSALS: string[] = [...SYNC_REFUSALS];
  const active = { state: 'active' as const, expiresAt: Date.now() + 86_400_000 };
  const expired = { state: 'active' as const, expiresAt: Date.now() - 86_400_000 };

  const cases: { what: string; env: Record<string, string>; org: OrgDoc; state: FarmSyncState }[] = [
    {
      what: 'comped in the environment',
      env: { ...withPlay, FREE_SYNC_ORGS: ORG },
      org: farm(),
      state: 'comped',
    },
    {
      what: 'comped in the database by farm:grant',
      env: withPlay,
      org: farm({ syncGranted: { at: new Date() } }),
      state: 'granted',
    },
    {
      what: 'on a server deliberately run open',
      env: { ...base, SYNC_OPEN_TO_ALL: '1' },
      org: farm(),
      state: 'open',
    },
    { what: 'paying', env: withPlay, org: farm({ subscription: active }), state: 'paid' },
    { what: 'never subscribed', env: withPlay, org: farm(), state: 'unsubscribed' },
    {
      what: 'lapsed',
      env: withPlay,
      org: farm({ subscription: expired }),
      state: 'lapsed',
    },
  ];

  for (const { what, env, org, state } of cases) {
    it(`says ${state} for a farm ${what}`, () => {
      expect(farmSyncState(readEnv(env), org)).toBe(state);
    });

    it(`agrees with what the wire does for a farm ${what}`, () => {
      const shown = farmSyncState(readEnv(env), org);
      const wire = syncAccess(readEnv(env), org);

      expect(REFUSALS.includes(shown)).toBe(!wire.syncing);
    });
  }

  /**
   * The bug this function exists to fix, kept as its own assertion because it
   * is the one a person actually hit. `farm:ls` read the grant and the
   * subscription and stopped, so the farms most likely to be looked up — the
   * comped ones — were listed as unsubscribed while syncing perfectly.
   */
  it('does not call a comped farm unsubscribed', () => {
    const env = readEnv({ ...withPlay, FREE_SYNC_ORGS: ORG });

    expect(syncAccess(env, farm()).syncing).toBe(true);
    expect(farmSyncState(env, farm())).not.toBe('unsubscribed');
  });
});
