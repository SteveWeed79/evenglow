import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDb } from '../support/mongo';

/**
 * One Play purchase, one farm.
 *
 * `DESIGN-BRIEF.md` §2 listed this under Major: *"A Play purchase token is not
 * bound to one farm — one subscription can entitle unlimited orgs."* Google
 * verifies the *purchase* and cannot know which farm is submitting it, so a
 * token that checks out says nothing about whose it is — and `/billing/play`
 * wrote `active` onto whichever org posted it.
 *
 * The defence is in two halves and both are asserted here, because either one
 * alone is weaker than it looks:
 *
 * - **The route refuses it**, so a farm gets a sentence rather than a surprise.
 * - **A unique partial index on `orgs.playPurchaseToken` settles it**, which is
 *   what makes the refusal true when two devices post in the same instant and
 *   when somebody later refactors past the check. D15 makes exactly this
 *   argument one field over: *"an index is a thing somebody can forget to
 *   create"* — so it is asserted rather than assumed to have been applied.
 *
 * The partial filter has its own test. Almost every farm has no purchase token
 * and never will, and a plain `unique: true` would let exactly one of them hold
 * the missing value — turning a paywall guard into a cap of one free farm per
 * deployment.
 */

const harness = await startTestDb('homefarm_purchase');

if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'homefarm_purchase';
}

const SECRET = 'a-test-secret-long-enough-for-hs256-abcdef';

/**
 * A syntactically valid service account, so `readPlayConfig` returns non-null
 * and the billing routes are live. Nothing here reaches Google: the refusal
 * happens before the store is asked, which is the point of checking first.
 */
const PLAY_ACCOUNT = JSON.stringify({
  client_email: 'billing@homefarm-test.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\\nnot-a-real-key\\n-----END PRIVATE KEY-----',
});

const ORG_A = ulid();
const ORG_B = ulid();
const OWNER_A = ulid();
const OWNER_B = ulid();
const TOKEN = 'play-purchase-token-belonging-to-farm-a';

const describeDb = harness ? describe : describe.skip;

async function server() {
  const { buildServer } = await import('@homefarm/api/server');
  const { readEnv } = await import('@homefarm/api/env');
  return buildServer(
    readEnv({
      AUTH_SECRET: SECRET,
      MONGODB_URI: harness!.uri,
      MONGODB_DB: 'homefarm_purchase',
      GOOGLE_PLAY_SERVICE_ACCOUNT: PLAY_ACCOUNT,
      GOOGLE_PLAY_PACKAGE: 'dev.swbuild.homefarm',
    }),
  );
}

async function tokenFor(userId: string, orgId: string) {
  const { startSession } = await import('@homefarm/api/auth/refresh');
  const { accessToken } = await startSession({ userId, orgId, role: 'owner' }, SECRET);
  return `Bearer ${accessToken}`;
}

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  if (!harness) return;
  await harness.db.collection('orgs').deleteMany({});
  await harness.db.collection('users').deleteMany({});
  await harness.db.collection('refreshTokens').deleteMany({});

  await harness.db.collection('orgs').insertMany([
    {
      _id: ORG_A as never,
      name: 'Hollow Farm',
      createdAt: new Date(),
      // Farm A bought a subscription, so its token is on its document.
      subscription: { state: 'active', source: 'play', updatedAt: Date.now() },
      playPurchaseToken: TOKEN,
    },
    { _id: ORG_B as never, name: 'Ridge Smallholding', createdAt: new Date() },
  ] as never);

  /**
   * The owners have to exist, and this is invariant 8 rather than fixture noise.
   *
   * `requireMutationClaims` does not trust the token it was handed — it looks
   * the user up by id, refuses a disabled one, and refuses one whose `orgId` no
   * longer matches the claim, then returns the role **from the database**. So a
   * signed token for a user who was never inserted is a 401, which is exactly
   * what the first version of this suite got and exactly what it should have
   * got: the server re-deriving identity rather than reading it off the wire.
   */
  await harness.db.collection('users').insertMany([
    {
      _id: OWNER_A as never,
      email: 'owner-a@example.test',
      name: 'Owner A',
      orgId: ORG_A,
      role: 'owner',
      createdAt: new Date(),
    },
    {
      _id: OWNER_B as never,
      email: 'owner-b@example.test',
      name: 'Owner B',
      orgId: ORG_B,
      role: 'owner',
      createdAt: new Date(),
    },
  ] as never);
});

describeDb('a purchase token belongs to one farm', () => {
  it('is matched back to the farm that submitted it', async () => {
    const { findOrgIdByPurchaseToken } = await import('@homefarm/api/db/identity');

    expect(await findOrgIdByPurchaseToken(TOKEN)).toBe(ORG_A);
    // A token nobody has submitted is either a forgery or an unfinished
    // signup, and both are nothing to act on.
    expect(await findOrgIdByPurchaseToken('never-seen-this-one')).toBeNull();
  });

  it('refuses a second farm posting the first farm’s token', async () => {
    const app = await server();

    const response = await app.inject({
      method: 'POST',
      url: '/billing/play',
      headers: { authorization: await tokenFor(OWNER_B, ORG_B) },
      payload: { purchaseToken: TOKEN },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatch(/already on another farm/i);

    /**
     * And farm B is left exactly as it was. The failure that matters is not
     * the status code, it is a second org walking away entitled — so the
     * assertion is about the document rather than the response.
     */
    const orgB = await harness!.db.collection('orgs').findOne({ _id: ORG_B as never });
    expect(orgB?.subscription).toBeUndefined();
    expect(orgB?.playPurchaseToken).toBeUndefined();

    await app.close();
  });

  it('refuses before it asks Google, so an unusable key never matters', async () => {
    /**
     * The service account above holds a fake private key, so any call to Google
     * would throw and surface as a 500. A clean 409 is therefore evidence the
     * check runs *first* — which is both why this test needs no network and why
     * a token already spent elsewhere is refused whatever the store would have
     * said about it.
     */
    const app = await server();

    const response = await app.inject({
      method: 'POST',
      url: '/billing/play',
      headers: { authorization: await tokenFor(OWNER_B, ORG_B) },
      payload: { purchaseToken: TOKEN },
    });

    expect(response.statusCode).toBe(409);
    await app.close();
  });

  it('lets the owning farm re-post its own token', async () => {
    /**
     * A renewal, a reinstall, or a retry after a dropped response. This must
     * not be refused — every other write path in this service is idempotent
     * because the mutation queue insists on it, and the one place that
     * punished a retry would be the one that cost somebody a subscription.
     *
     * Farm A gets past the binding check and on to Google, which the fake key
     * makes fail — so the assertion is only that it is **not** a 409. Anything
     * past the check is the store's business and needs a Play sandbox, not a
     * unit test.
     */
    const app = await server();

    const response = await app.inject({
      method: 'POST',
      url: '/billing/play',
      headers: { authorization: await tokenFor(OWNER_A, ORG_A) },
      payload: { purchaseToken: TOKEN },
    });

    expect(response.statusCode).not.toBe(409);
    await app.close();
  });
});

describeDb('the index behind the check', () => {
  beforeEach(async () => {
    const { applyIndexes } = await import('@homefarm/api/db/indexes');
    await applyIndexes(harness!.db);
  });

  it('refuses a duplicate token at the database, not only at the route', async () => {
    /**
     * The race the route check cannot win: two farms posting one token in the
     * same instant, both finding it unbound. This is what actually settles it,
     * and `/billing/play` translates the duplicate-key error back into the same
     * sentence so the loser is not told "Something went wrong".
     */
    await expect(
      harness!.db
        .collection('orgs')
        .updateOne({ _id: ORG_B as never }, { $set: { playPurchaseToken: TOKEN } }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('lets any number of farms hold no token at all', async () => {
    /**
     * The partial filter, and the reason it is not merely `sparse`. Free farms
     * never have a purchase token — that is most of them, forever — and a plain
     * unique index would admit exactly one such document and reject the rest,
     * capping the deployment at one free farm.
     */
    const free = Array.from({ length: 25 }, () => ({
      _id: ulid() as never,
      name: 'A farm with no subscription',
      createdAt: new Date(),
    }));

    await expect(harness!.db.collection('orgs').insertMany(free as never)).resolves.toBeTruthy();
    expect(await harness!.db.collection('orgs').countDocuments()).toBe(27);
  });

});

/**
 * The index *declaration* is asserted in `tests/unit/indexes.test.ts` instead,
 * deliberately. It is pure, so putting it here as well would hide it behind a
 * suite that skips without a mongod — which is the same shape as the defect
 * D15 warns about, one layer up: a guard whose only test is one that might not
 * run.
 */
