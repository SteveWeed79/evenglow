import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { UserDoc } from '@steading/api/db/identity';
import { startTestDb } from '../support/mongo';

/**
 * The one surface on this box that reads every farm.
 *
 * Everywhere else, `scoped()` makes cross-tenant reads structurally impossible
 * and the isolation suite proves it. The board is the deliberate exception —
 * so the thing to prove here is not that tenancy holds, but that **the door
 * holds**: who may open it, what it says to somebody who may not, and that
 * what comes through it is counts rather than contents.
 *
 * A farmer with a perfectly valid token is the interesting case. Every account
 * on the server has one, `verifyAccessToken` will happily verify it, and the
 * only thing between an owner and every other farm's numbers is the role check.
 */

const harness = await startTestDb('steading_ops_board');

if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'steading_ops_board';
}

const describeDb = harness ? describe : describe.skip;

const SECRET = 'a-test-secret-long-enough-for-hs256-abcdef';
const PASSWORD = 'a-long-enough-test-password';

const ORG_A = ulid();
const ORG_B = ulid();

const USERS = {
  admin: { _id: ulid(), orgId: ORG_A, role: 'admin' as const },
  owner: { _id: ulid(), orgId: ORG_A, role: 'owner' as const },
  hand: { _id: ulid(), orgId: ORG_B, role: 'hand' as const },
};

type TestUser = (typeof USERS)[keyof typeof USERS];

const emailOf = (user: TestUser) => `${user._id.toLowerCase()}@example.test`;

async function buildApp() {
  const { buildOpsServer } = await import('@steading/api/ops/server');
  const { readEnv } = await import('@steading/api/env');
  return buildOpsServer(
    readEnv({
      AUTH_SECRET: SECRET,
      MONGODB_URI: harness!.uri,
      MONGODB_DB: 'steading_ops_board',
    }),
  );
}

async function tokenFor(user: TestUser): Promise<string> {
  const { mintAccessToken } = await import('@steading/api/auth/tokens');
  return mintAccessToken({ userId: user._id, orgId: user.orgId, role: user.role }, SECRET);
}

async function get(path: string, user?: TestUser) {
  const app = await buildApp();
  const res = await app.inject({
    method: 'GET',
    url: path,
    headers: user === undefined ? {} : { authorization: `Bearer ${await tokenFor(user)}` },
  });
  await app.close();
  return { status: res.statusCode, body: res.body };
}

async function post(path: string, payload: unknown, user?: TestUser) {
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST',
    url: path,
    headers: user === undefined ? {} : { authorization: `Bearer ${await tokenFor(user)}` },
    payload: payload as never,
  });
  await app.close();
  return { status: res.statusCode, body: res.body };
}

beforeEach(async () => {
  const { hashPassword } = await import('@steading/api/auth/password');
  const { insertOrg, insertUser } = await import('@steading/api/db/identity');

  for (const name of [
    'users',
    'orgs',
    'mutations',
    'flocks',
    'promoCodes',
    'invites',
    'serverHealth',
  ]) {
    await harness!.db.collection(name).deleteMany({});
  }

  await insertOrg({ _id: ORG_A, name: 'Hollow Farm', createdAt: new Date() });
  await insertOrg({ _id: ORG_B, name: 'Far Field', createdAt: new Date() });

  const passwordHash = await hashPassword(PASSWORD);
  for (const user of Object.values(USERS)) {
    await insertUser({
      _id: user._id,
      email: emailOf(user),
      passwordHash,
      name: `The ${user.role}`,
      orgId: user.orgId,
      role: user.role,
      createdAt: new Date(),
    } satisfies UserDoc);
  }
});

afterAll(async () => {
  await harness?.stop();
});

describeDb('the board itself', () => {
  it('is refused outright without a token', async () => {
    expect((await get('/board')).status).toBe(401);
  });

  /**
   * **The assertion this file exists for.** An owner's token is genuine, signed
   * by this server, and unexpired. The role is the only thing standing between
   * it and every farm on the box.
   */
  it('is refused to a farm owner, whose token is otherwise perfectly good', async () => {
    expect((await get('/board', USERS.owner)).status).toBe(403);
  });

  it('is refused to a hand', async () => {
    expect((await get('/board', USERS.hand)).status).toBe(403);
  });

  it('opens for an administrator', async () => {
    const answer = await get('/board', USERS.admin);
    expect(answer.status).toBe(200);

    const board = JSON.parse(answer.body) as { farms: { name: string }[] };
    expect(board.farms.map((f) => f.name).sort()).toEqual(['Far Field', 'Hollow Farm']);
  });

  /**
   * Counts and timings, never contents — the line `ACCESS-AND-BILLING.md` §5
   * draws for `farm:show`, asserted rather than intended.
   *
   * Checked against the whole serialised response rather than field by field,
   * because the failure this guards against is somebody widening a projection
   * later and nobody noticing which fields came along.
   */
  it("carries no farm's records, only numbers about them", async () => {
    await harness!.db.collection('flocks').insertOne({
      _id: ulid() as never,
      orgId: ORG_A,
      name: 'The secret goats',
      species: 'goat',
      count: 12,
    } as never);
    await harness!.db.collection('mutations').insertOne({
      _id: ulid() as never,
      orgId: ORG_A,
      entity: 'flock',
      payload: { name: 'The secret goats' },
      serverTs: new Date(),
    } as never);

    const answer = await get('/board', USERS.admin);

    expect(answer.status).toBe(200);
    expect(answer.body).not.toContain('secret goats');
    // The count did come through, so the absence above is a filter and not an
    // empty board.
    expect(JSON.parse(answer.body).farms.find((f: { name: string }) => f.name === 'Hollow Farm')
      .records).toBe(1);
  });
});

describeDb('signing in to the board', () => {
  it('gives an administrator a token', async () => {
    const answer = await post('/session', { email: emailOf(USERS.admin), password: PASSWORD });

    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body).token).toEqual(expect.any(String));
  });

  /**
   * The refusals are deliberately identical. `authorizeCredentials` already
   * answers the same way for an unknown address and a wrong password so the
   * response cannot be used to enumerate accounts; a distinct "correct, but not
   * an admin" would hand that back for exactly the accounts worth finding.
   */
  it('says the same thing to a farmer, a wrong password and a stranger', async () => {
    const asFarmer = await post('/session', { email: emailOf(USERS.owner), password: PASSWORD });
    const wrongPassword = await post('/session', { email: emailOf(USERS.admin), password: 'nope' });
    const stranger = await post('/session', { email: 'nobody@example.test', password: PASSWORD });

    for (const answer of [asFarmer, wrongPassword, stranger]) {
      expect(answer.status).toBe(401);
      expect(answer.body).toBe(asFarmer.body);
    }
  });

  /**
   * Its own registration, because Fastify's encapsulation means the limiters on
   * the API's routes cover nothing here. Without it the password is the only
   * control, and a password with unlimited guesses is a matter of time.
   */
  it('stops answering after five tries in a minute', async () => {
    const app = await buildApp();
    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/session',
        payload: { email: emailOf(USERS.admin), password: 'wrong' },
      });

    const codes: number[] = [];
    for (let i = 0; i < 7; i += 1) codes.push((await attempt()).statusCode);
    await app.close();

    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes.slice(5)).toEqual([429, 429]);
  });
});

describeDb('the two things the board can change', () => {
  it('mints a code for an administrator and shows it exactly once', async () => {
    const answer = await post('/actions/promo', { days: 30, uses: 2 }, USERS.admin);

    expect(answer.status).toBe(200);
    const minted = JSON.parse(answer.body) as { code: string; days: number; uses: number };
    expect(minted).toMatchObject({ days: 30, uses: 2 });
    expect(minted.code).toEqual(expect.any(String));

    // Stored hashed, so what was returned is not what is on disk.
    const stored = await harness!.db.collection('promoCodes').findOne({});
    expect(stored?._id).not.toBe(minted.code);
    expect(stored?.maxRedemptions).toBe(2);
  });

  it('refuses to mint for a farm owner', async () => {
    expect((await post('/actions/promo', { days: 30, uses: 1 }, USERS.owner)).status).toBe(403);
    expect(await harness!.db.collection('promoCodes').countDocuments({})).toBe(0);
  });

  it('grants a farm sync, and takes it back', async () => {
    const granted = await post('/actions/grant', { orgId: ORG_B, revoke: false }, USERS.admin);
    expect(granted.status).toBe(200);
    expect(JSON.parse(granted.body)).toMatchObject({ name: 'Far Field', granted: true });
    expect(
      (await harness!.db.collection('orgs').findOne({ _id: ORG_B as never }))?.syncGranted,
    ).toBeDefined();

    const revoked = await post('/actions/grant', { orgId: ORG_B, revoke: true }, USERS.admin);
    expect(JSON.parse(revoked.body)).toMatchObject({ granted: false });
    expect(
      (await harness!.db.collection('orgs').findOne({ _id: ORG_B as never }))?.syncGranted,
    ).toBeUndefined();
  });

  it('refuses to grant for a hand', async () => {
    expect((await post('/actions/grant', { orgId: ORG_B, revoke: false }, USERS.hand)).status).toBe(
      403,
    );
  });

  /**
   * Said rather than silently ignored. An operator pasting an id from
   * somewhere has to hear that it matched nothing, or they will believe a
   * grant happened.
   */
  it('says so when the farm id matches nothing', async () => {
    expect((await post('/actions/grant', { orgId: ulid(), revoke: false }, USERS.admin)).status)
      .toBe(404);
  });

  /**
   * The rule is *no credential-changing actions*, and the way it is kept is
   * that there is no route for one. `db:password` sets any account's password,
   * which makes a button for it an account-takeover primitive — equally true on
   * localhost, so it is not an argument about where the page is served.
   */
  it("has no route that could change anybody's password", async () => {
    for (const path of ['/actions/password', '/actions/set-password', '/password']) {
      expect((await post(path, { userId: USERS.owner._id }, USERS.admin)).status).toBe(404);
    }
  });
});

describeDb('the page', () => {
  it('is served without a token, because it is a sign-in form', async () => {
    const answer = await get('/');

    expect(answer.status).toBe(200);
    expect(answer.body).toContain('Steading operations');
  });

  /** Nothing about a farm reaches the browser before somebody has signed in. */
  it('carries no data of its own', async () => {
    const answer = await get('/');

    expect(answer.body).not.toContain('Hollow Farm');
    expect(answer.body).not.toContain(ORG_A);
  });
});

/**
 * A token that says `admin` is not the same as an account that is one.
 *
 * **The door was opened by the token alone**, which is invariant 8 inverted:
 * cached claims gate local UX, and the server re-derives identity and role on
 * every mutation. Two of the board's routes *are* mutations — one gives a farm
 * free sync, the other mints a subscription code — so somebody demoted or
 * removed a minute ago kept both for the fifteen minutes an access token lives.
 *
 * The tokens below are genuine: minted by this server, correctly signed, not
 * expired. What changed underneath them is the row.
 */
describeDb('an administrator who no longer is one', () => {
  it('is refused the board once the row says otherwise', async () => {
    // The token still says admin, because it was minted before this.
    const token = await tokenFor(USERS.admin);
    await harness!.db
      .collection('users')
      .updateOne({ _id: USERS.admin._id as never }, { $set: { role: 'owner' } });

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/board',
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });

  /** And the two routes that write, which is where it actually mattered. */
  it('cannot mint a promotion code with a stale token', async () => {
    const token = await tokenFor(USERS.admin);
    await harness!.db
      .collection('users')
      .updateOne({ _id: USERS.admin._id as never }, { $set: { role: 'owner' } });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/actions/promo',
      headers: { authorization: `Bearer ${token}` },
      payload: { months: 12, maxRedemptions: 1 } as never,
    });
    await app.close();

    expect(res.statusCode).toBe(403);
    expect(await harness!.db.collection('promoCodes').countDocuments({})).toBe(0);
  });

  it('cannot grant a farm free sync with a stale token', async () => {
    const token = await tokenFor(USERS.admin);
    await harness!.db
      .collection('users')
      .updateOne({ _id: USERS.admin._id as never }, { $set: { role: 'owner' } });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/actions/grant',
      headers: { authorization: `Bearer ${token}` },
      payload: { orgId: ORG_B, granted: true } as never,
    });
    await app.close();

    expect(res.statusCode).toBe(403);
    const org = await harness!.db.collection('orgs').findOne({ _id: ORG_B as never });
    expect(org?.syncGranted).toBeUndefined();
  });

  /**
   * A removed account is a 401 rather than the 403 above: it is not a role
   * problem, and signing in again is the only thing to do about it.
   */
  it('is signed out, not merely demoted, once the account is disabled', async () => {
    const token = await tokenFor(USERS.admin);
    await harness!.db
      .collection('users')
      .updateOne({ _id: USERS.admin._id as never }, { $set: { disabledAt: new Date() } });

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/board',
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });
});

/**
 * The sweep panel, which reported nothing on every box for ever.
 *
 * `startSweeper()` runs in the **API** unit and the board is the **ops** unit —
 * a separate entry point, a separate port, a separate systemd service, all
 * deliberately. A module variable written in one process is invisible in the
 * other, so the panel built because *"a silent journal and a broken timer look
 * identical"* could not tell them apart either.
 *
 * These assertions read the board through its own route with nothing having
 * swept in this process, which is exactly the situation on a real box.
 */
describeDb('what the board says about the sweep', () => {
  it('says nothing has run when no pass has been recorded', async () => {
    const answer = await get('/board', USERS.admin);
    const body = JSON.parse(answer.body) as { health: { sweep: { at: string | null } } };

    expect(answer.status).toBe(200);
    expect(body.health.sweep.at).toBeNull();
  });

  it('reports a pass recorded by another process', async () => {
    const { recordSweep } = await import('@steading/api/db/sweep-status');
    await recordSweep({
      at: new Date(),
      host: 'the-api-unit',
      startedAt: new Date(),
      report: { found: 4, decided: 3, unreadable: 1, orphaned: 0, refused: 0, capped: false },
    });

    const answer = await get('/board', USERS.admin);
    const body = JSON.parse(answer.body) as {
      health: { sweep: { at: string | null; found: number; decided: number; host: string } };
    };

    expect(body.health.sweep.at).not.toBeNull();
    expect(body.health.sweep.found).toBe(4);
    expect(body.health.sweep.decided).toBe(3);
    // Which process wrote it, so a stale row is recognisable as one.
    expect(body.health.sweep.host).toBe('the-api-unit');
  });

  it('carries a failed pass, which is the one worth seeing', async () => {
    const { recordSweep } = await import('@steading/api/db/sweep-status');
    await recordSweep({
      at: new Date(),
      host: 'the-api-unit',
      startedAt: new Date(),
      failed: 'mongo went away',
    });

    const answer = await get('/board', USERS.admin);
    const body = JSON.parse(answer.body) as { health: { sweep: { failed: string | null } } };

    expect(body.health.sweep.failed).toBe('mongo went away');
  });

  /** A pass that stopped at its ceiling is not the same as one that finished. */
  it('says when the last pass stopped short', async () => {
    const { recordSweep } = await import('@steading/api/db/sweep-status');
    await recordSweep({
      at: new Date(),
      host: 'the-api-unit',
      startedAt: new Date(),
      report: { found: 5000, decided: 5000, unreadable: 0, orphaned: 0, refused: 0, capped: true },
    });

    const answer = await get('/board', USERS.admin);
    const body = JSON.parse(answer.body) as { health: { sweep: { capped: boolean } } };

    expect(body.health.sweep.capped).toBe(true);
  });
});
