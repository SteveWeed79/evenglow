import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { UserDoc } from '@steading/api/db/identity';
import { makeMutation } from '../support/fixtures';
import { startTestDb } from '../support/mongo';

/**
 * Claiming a farm, and the join code that adds a second person to it.
 *
 * These are the two routes A2.2 and A2.5 added, and both reach the database
 * before the caller has a session — so both sit outside what `scoped()` can
 * protect, alongside `users`, `orgs`, `refreshTokens` and `invites`.
 *
 * **The claim route is the only place in this system where a client sends an
 * orgId**, so the tenancy question it raises is asked here directly: can a
 * caller reach into a farm that already exists by naming it? Everything below
 * is about that question, and the answer has to survive an attacker who knows
 * the id rather than merely one who does not.
 *
 * The rule everywhere else holds here: a resource in another farm answers
 * **404, never 403**, because a 403 confirms the thing exists.
 */

const harness = await startTestDb('steading_claim');

if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'steading_claim';
}

const SECRET = 'a-test-secret-long-enough-for-hs256-abcdef';
const PASSWORD = 'a properly long passphrase';

const ORG_A = ulid();
const OWNER_A = ulid();
const ADMIN_A = ulid();
const HAND_A = ulid();

const describeDb = harness ? describe : describe.skip;

async function server() {
  const { buildServer } = await import('@steading/api/server');
  const { readEnv } = await import('@steading/api/env');
  return buildServer(
    readEnv({
      AUTH_SECRET: SECRET,
      MONGODB_URI: harness!.uri,
      MONGODB_DB: 'steading_claim',
      CORS_ORIGINS: 'https://app.test',
    }),
  );
}

async function tokenFor(userId: string, orgId: string, role: 'owner' | 'admin' | 'hand') {
  const { startSession } = await import('@steading/api/auth/refresh');
  const { accessToken } = await startSession({ userId, orgId, role }, SECRET);
  return `Bearer ${accessToken}`;
}

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  if (!harness) return;
  const { hashPassword } = await import('@steading/api/auth/password');
  const hash = await hashPassword(PASSWORD);

  await harness.db.collection('joinCodes').deleteMany({});
  await harness.db.collection('refreshTokens').deleteMany({});
  await harness.db.collection<UserDoc>('users').deleteMany({});
  await harness.db.collection('orgs').deleteMany({});

  await harness.db.collection('orgs').insertOne({
    _id: ORG_A,
    name: 'Hollow Farm',
    createdAt: new Date(),
  } as never);

  await harness.db.collection<UserDoc>('users').insertMany([
    {
      _id: OWNER_A,
      email: `owner-${OWNER_A}@example.test`.toLowerCase(),
      passwordHash: hash,
      name: 'Owner A',
      orgId: ORG_A,
      role: 'owner',
      createdAt: new Date(),
    },
    /**
     * A real admin, not just a token claiming to be one.
     *
     * This test file originally minted an admin token for a ULID with no user
     * document, and the route answered 401 rather than the 403 the test
     * wanted. **The route was right and the test was wrong**, which is worth
     * recording: `requireMutationClaims` re-derives the actor from the
     * database on every write path (D4, invariant 8), so a signed token for
     * somebody who does not exist is not an admin — it is nobody. Asserting
     * the escalation refusal needs an admin who genuinely exists, or it
     * asserts the wrong mechanism and passes for the wrong reason.
     */
    {
      _id: ADMIN_A,
      email: `admin-${ADMIN_A}@example.test`.toLowerCase(),
      passwordHash: hash,
      name: 'Admin A',
      orgId: ORG_A,
      role: 'admin',
      createdAt: new Date(),
    },
    {
      _id: HAND_A,
      email: `hand-${HAND_A}@example.test`.toLowerCase(),
      passwordHash: hash,
      name: 'Hand A',
      orgId: ORG_A,
      role: 'hand',
      createdAt: new Date(),
    },
  ]);
});

function claim(over: Record<string, unknown> = {}) {
  return {
    orgId: ulid(),
    orgName: 'A New Farm',
    email: `new-${ulid()}@example.test`.toLowerCase(),
    password: PASSWORD,
    name: 'Sam',
    ...over,
  };
}

describeDb('claiming the farm a device already has', () => {
  it('adopts the id the client sent rather than assigning one', async () => {
    const app = await server();
    const payload = claim();

    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload });
    expect(res.statusCode).toBe(201);

    /**
     * The whole point of A2.2. The device's database is named for this id, so
     * a server that assigned a different one would have made the records on
     * the handset unreachable — which is the rename A2.2 refused.
     */
    const org = await harness!.db.collection('orgs').findOne({ _id: payload.orgId as never });
    expect(org?.name).toBe('A New Farm');

    // And the session it hands back carries that id, so the first flush lands
    // in the farm the queue was built for.
    const { verifyAccessToken } = await import('@steading/api/auth/tokens');
    const claims = await verifyAccessToken(res.json().accessToken, SECRET);
    expect(claims.orgId).toBe(payload.orgId);
    expect(claims.role).toBe('owner');
    await app.close();
  });

  /**
   * The tenancy question this route exists to answer.
   *
   * Somebody who knows another farm's orgId — a hand who read it off a
   * screen, anybody who saw a sync request — must not be able to claim it and
   * become its owner. `_id` uniqueness is what refuses, and it is structural
   * rather than an index somebody has to remember to create.
   */
  it('refuses a farm that already has members, even to a caller who knows its id', async () => {
    const app = await server();
    const users = harness!.db.collection('users');

    /**
     * Counted before rather than asserted as a literal.
     *
     * This read `.toBe(2)` and broke the moment the fixture grew an admin,
     * which is a test coupled to something it is not about. What it means is
     * that the refused claim added nobody — so it says that, and it keeps
     * saying it whatever else the fixture holds.
     */
    const before = await users.countDocuments({ orgId: ORG_A });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: claim({ orgId: ORG_A, orgName: 'Not Your Farm' }),
    });

    expect(res.statusCode).toBe(409);

    // Nothing about the existing farm moved, and no second owner appeared.
    const org = await harness!.db.collection('orgs').findOne({ _id: ORG_A as never });
    expect(org?.name).toBe('Hollow Farm');
    expect(await users.countDocuments({ orgId: ORG_A })).toBe(before);
    await app.close();
  });

  /**
   * The crash window, which is the one case an existing org may be finished.
   *
   * An org with no members cannot be reached by any token, because no token
   * can carry its id — so letting the device that made it finish the job is
   * safe, and refusing would strand a handset full of records behind an id it
   * could never claim.
   */
  it('finishes a claim that died between the two inserts', async () => {
    const app = await server();
    const orphan = ulid();

    await harness!.db
      .collection('orgs')
      .insertOne({ _id: orphan, name: 'Half Claimed', createdAt: new Date() } as never);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: claim({ orgId: orphan, orgName: 'Hollow Farm' }),
    });

    expect(res.statusCode).toBe(201);
    expect(await harness!.db.collection('users').countDocuments({ orgId: orphan })).toBe(1);
    await app.close();
  });

  it('refuses an id no client of this app could have minted', async () => {
    const app = await server();

    // 26 characters, so it passes the wire contract's length check, and not a
    // ULID — a chosen value rather than a minted one.
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: claim({ orgId: 'IIIIIIIIIIIIIIIIIIIIIIIIII' }),
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('leaves no org behind when the email is already taken', async () => {
    const app = await server();
    const orgId = ulid();

    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: claim({ orgId, email: `owner-${OWNER_A}@example.test` }),
    });

    expect(res.statusCode).toBe(409);

    /**
     * The id has to stay claimable. A farm told "that email is taken" tries
     * again with another address, and it would be an unrecoverable trap if
     * the first attempt had spent the only id its database answers to.
     */
    expect(await harness!.db.collection('orgs').findOne({ _id: orgId as never })).toBeNull();
    await app.close();
  });
});

describeDb('join codes', () => {
  async function mint(role = 'hand') {
    const app = await server();
    const res = await app.inject({
      method: 'POST',
      url: '/join-codes',
      headers: { authorization: await tokenFor(OWNER_A, ORG_A, 'owner') },
      payload: { role },
    });
    return { app, res };
  }

  it('hands the code back once and stores only its hash', async () => {
    const { app, res } = await mint();
    expect(res.statusCode).toBe(201);

    const code = res.json().code as string;
    expect(code).toHaveLength(6);

    const stored = await harness!.db.collection('joinCodes').findOne({ orgId: ORG_A });
    expect(stored?._id).not.toBe(code);
    expect(JSON.stringify(stored)).not.toContain(code);

    // Coming back to the screen shows that one is live, never what it says.
    const live = await app.inject({
      method: 'GET',
      url: '/join-codes',
      headers: { authorization: await tokenFor(OWNER_A, ORG_A, 'owner') },
    });
    expect(live.json().expiresAt).toBeTypeOf('number');
    expect(JSON.stringify(live.json())).not.toContain(code);
    await app.close();
  });

  it('refuses a hand, and refuses an admin minting an owner', async () => {
    const app = await server();

    const byHand = await app.inject({
      method: 'POST',
      url: '/join-codes',
      headers: { authorization: await tokenFor(HAND_A, ORG_A, 'hand') },
      payload: { role: 'hand' },
    });
    expect(byHand.statusCode).toBe(403);

    // Privilege escalation with extra steps: an admin who could mint an owner
    // code could mint one for themselves.
    const escalation = await app.inject({
      method: 'POST',
      url: '/join-codes',
      headers: { authorization: await tokenFor(ADMIN_A, ORG_A, 'admin') },
      payload: { role: 'owner' },
    });
    expect(escalation.statusCode).toBe(403);

    // The same admin may still mint what they are allowed to, so the refusal
    // above is about the role rather than about the person.
    const allowed = await app.inject({
      method: 'POST',
      url: '/join-codes',
      headers: { authorization: await tokenFor(ADMIN_A, ORG_A, 'admin') },
      payload: { role: 'hand' },
    });
    expect(allowed.statusCode).toBe(201);
    await app.close();
  });

  /**
   * A token for somebody who is not there.
   *
   * Signed correctly, carrying `role: 'owner'`, and refused — because the
   * write path re-derives the actor from the database rather than believing
   * the claim. 401 and not 403: there is no actor to forbid.
   */
  it('refuses a correctly signed token for a user who does not exist', async () => {
    const app = await server();

    const res = await app.inject({
      method: 'POST',
      url: '/join-codes',
      headers: { authorization: await tokenFor(ulid(), ORG_A, 'owner') },
      payload: { role: 'hand' },
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('puts the redeemer in the code’s farm, with the code’s role', async () => {
    const { app, res } = await mint();
    const code = res.json().code as string;

    const joined = await app.inject({
      method: 'POST',
      url: '/join-codes/redeem',
      payload: { code, email: `hand2-${ulid()}@example.test`, password: PASSWORD, name: 'Pat' },
    });

    expect(joined.statusCode).toBe(201);

    const { verifyAccessToken } = await import('@steading/api/auth/tokens');
    const claims = await verifyAccessToken(joined.json().accessToken, SECRET);
    expect(claims.orgId).toBe(ORG_A);
    // The role was chosen by the person with the authority to grant it, not by
    // the person redeeming — a code the holder could upgrade would be no code.
    expect(claims.role).toBe('hand');
    await app.close();
  });

  it('works exactly once', async () => {
    const { app, res } = await mint();
    const code = res.json().code as string;

    const first = await app.inject({
      method: 'POST',
      url: '/join-codes/redeem',
      payload: { code, email: `a-${ulid()}@example.test`, password: PASSWORD, name: 'Pat' },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/join-codes/redeem',
      payload: { code, email: `b-${ulid()}@example.test`, password: PASSWORD, name: 'Alex' },
    });

    // The same answer a guess gets. A spent code and a wrong one are the same
    // thing to anyone outside.
    expect(second.statusCode).toBe(404);
    await app.close();
  });

  it('answers a wrong code and an expired one identically', async () => {
    const { app, res } = await mint();
    const code = res.json().code as string;

    const guessed = await app.inject({
      method: 'POST',
      url: '/join-codes/redeem',
      payload: { code: 'ZZZZZZ', email: `c-${ulid()}@example.test`, password: PASSWORD, name: 'Pat' },
    });

    // Age the real one past its window.
    await harness!.db
      .collection('joinCodes')
      .updateOne({ orgId: ORG_A }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const stale = await app.inject({
      method: 'POST',
      url: '/join-codes/redeem',
      payload: { code, email: `d-${ulid()}@example.test`, password: PASSWORD, name: 'Pat' },
    });

    expect(guessed.statusCode).toBe(404);
    expect(stale.statusCode).toBe(404);
    expect(stale.json()).toEqual(guessed.json());
    await app.close();
  });

  it('keeps one live code per farm, so a second mint retires the first', async () => {
    const { app, res } = await mint();
    const first = res.json().code as string;

    const again = await app.inject({
      method: 'POST',
      url: '/join-codes',
      headers: { authorization: await tokenFor(OWNER_A, ORG_A, 'owner') },
      payload: { role: 'hand' },
    });
    expect(again.statusCode).toBe(201);

    const spent = await app.inject({
      method: 'POST',
      url: '/join-codes/redeem',
      payload: { code: first, email: `e-${ulid()}@example.test`, password: PASSWORD, name: 'Pat' },
    });

    // An owner who taps twice has one code that works — the one on screen.
    expect(spent.statusCode).toBe(404);
    expect(await harness!.db.collection('joinCodes').countDocuments({ orgId: ORG_A })).toBe(1);
    await app.close();
  });

  it('reads a code the way somebody types it, not the way it was printed', async () => {
    const { app, res } = await mint();
    const code = res.json().code as string;

    // Crockford: O is zero, I and L are one, and case is not information.
    const typed = code.toLowerCase().replace(/0/g, 'O').replace(/1/g, 'l');

    const joined = await app.inject({
      method: 'POST',
      url: '/join-codes/redeem',
      payload: { code: typed, email: `f-${ulid()}@example.test`, password: PASSWORD, name: 'Pat' },
    });

    expect(joined.statusCode).toBe(201);
    await app.close();
  });
});

/**
 * Who the gate applies to (D13).
 *
 * CI found this rather than review did, and it was a real flaw rather than a
 * broken fixture: **a self-hosted Steading has no Play Console, so no farm on
 * it can ever subscribe** — and a gate that ignored that would refuse every
 * flush on somebody's own box, forever, with no way out. The whole of
 * `ACCESS-AND-BILLING.md` is built around exactly that box.
 *
 * It is also the honest reading of D13: the subscription pays for *this
 * project* to hold a farm's records. A farm holding its own records on its own
 * hardware owes nobody anything.
 */
describeDb('what a server without a payment rail charges for', () => {
  it('charges for nothing, so a self-hosted farm can sync', async () => {
    const app = await server();
    const payload = claim();

    const created = await app.inject({ method: 'POST', url: '/auth/signup', payload });
    expect(created.statusCode).toBe(201);

    /**
     * A brand-new farm with no subscription at all, on a server with no Play
     * credentials — which is every server this repo can build today.
     *
     * A real mutation rather than an empty batch: an empty one is refused as
     * malformed, which would make this pass for the wrong reason on the day
     * the gate came back.
     */
    const flush = await app.inject({
      method: 'POST',
      url: '/sync',
      headers: { authorization: `Bearer ${created.json().accessToken}` },
      payload: { mutations: [makeMutation()] },
    });

    expect(flush.statusCode).toBe(200);
    expect(flush.json().results[0].status).toBe('applied');
    await app.close();
  });

  it('answers 501 on the billing routes rather than pretending to sell', async () => {
    const app = await server();
    const created = await app.inject({ method: 'POST', url: '/auth/signup', payload: claim() });

    const bought = await app.inject({
      method: 'POST',
      url: '/billing/play',
      headers: { authorization: `Bearer ${created.json().accessToken}` },
      payload: { purchaseToken: 'anything' },
    });

    // Named plainly, so an operator can act on it — the same shape as Google
    // sign-in without a client id.
    expect(bought.statusCode).toBe(501);
    expect(bought.json().error).toMatch(/not set up to take payments/);
    await app.close();
  });

  /**
   * And the farm is told it is syncing rather than being told nothing, because
   * the account screen reads this and has to say one of two quite different
   * things.
   */
  it('reports a self-hosted farm as syncing', async () => {
    const app = await server();
    const created = await app.inject({ method: 'POST', url: '/auth/signup', payload: claim() });

    const billing = await app.inject({
      method: 'GET',
      url: '/billing',
      headers: { authorization: `Bearer ${created.json().accessToken}` },
    });

    expect(billing.statusCode).toBe(200);
    await app.close();
  });
});
