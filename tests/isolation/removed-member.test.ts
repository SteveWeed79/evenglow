import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { OrgDoc, UserDoc } from '@homefarm/api/db/identity';
import { startTestDb } from '../support/mongo';

/**
 * What is left of somebody after they are removed from a farm.
 *
 * **Reported from a farm: a person who joined with a code and was then removed
 * could not create a farm of their own.** They could not do anything at all,
 * and the chain that trapped them was four things each of which was reasonable:
 *
 * 1. `email` is globally unique — one address, one account, one farm.
 * 2. Removal is a disable, not a delete, so the farm's records keep naming who
 *    typed them. The row survives, still holding the address.
 * 3. Sign-in refuses a disabled account. Correct: access ended.
 * 4. Signup refuses an address that already has an account — and says *"that
 *    email already has a Steading account, sign in with it instead"*, which is
 *    advice to do the thing that also fails.
 *
 * One removal burned an address permanently. So removal releases it now, and
 * the row keeps the name and the history. These are the four corners of that:
 * the address comes free, the farm can still see who it was, access really has
 * ended, and Google is released too — releasing only the email would leave
 * anybody who signed up that way exactly as stuck as before.
 */

const harness = await startTestDb('homefarm_removed_member');

if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'homefarm_removed_member';
}

const SECRET = 'a-test-secret-long-enough-for-hs256-abcdef';
const PASSWORD = 'a properly long passphrase';

const ORG = ulid();
const OWNER = ulid();
const HAND = ulid();
const OWNER_EMAIL = `owner-${OWNER}@example.test`.toLowerCase();
const HAND_EMAIL = `hand-${HAND}@example.test`.toLowerCase();

const describeDb = harness ? describe : describe.skip;

async function server() {
  const { buildServer } = await import('@homefarm/api/server');
  const { readEnv } = await import('@homefarm/api/env');
  return buildServer(
    readEnv({
      AUTH_SECRET: SECRET,
      MONGODB_URI: harness!.uri,
      MONGODB_DB: 'homefarm_removed_member',
      CORS_ORIGINS: 'https://app.test',
    }),
  );
}

/** The owner's access token, for the removal call. */
async function ownerToken(app: Awaited<ReturnType<typeof server>>): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: OWNER_EMAIL, password: PASSWORD },
  });
  return res.json().accessToken;
}

/** Removes the hand, and asserts the farm agreed to it. */
async function removeTheHand(app: Awaited<ReturnType<typeof server>>): Promise<void> {
  const res = await app.inject({
    method: 'DELETE',
    url: `/members/${HAND}`,
    headers: { authorization: `Bearer ${await ownerToken(app)}` },
  });
  expect(res.statusCode).toBe(204);
}

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  if (!harness) return;
  const { hashPassword } = await import('@homefarm/api/auth/password');
  const hash = await hashPassword(PASSWORD);

  await harness.db.collection('refreshTokens').deleteMany({});
  await harness.db.collection<OrgDoc>('orgs').deleteMany({});
  await harness.db.collection<UserDoc>('users').deleteMany({});

  // Typed rather than `as never`, which the older suites reach for: `_id` is a
  // ULID string and `OrgDoc` already says so.
  await harness.db.collection<OrgDoc>('orgs').insertOne({
    _id: ORG,
    name: 'The first farm',
    createdAt: new Date(),
  });

  await harness.db.collection<UserDoc>('users').insertMany([
    {
      _id: OWNER,
      email: OWNER_EMAIL,
      passwordHash: hash,
      name: 'The owner',
      orgId: ORG,
      role: 'owner',
      createdAt: new Date(),
    },
    {
      _id: HAND,
      email: HAND_EMAIL,
      passwordHash: hash,
      name: 'The hand',
      orgId: ORG,
      role: 'hand',
      createdAt: new Date(),
    },
  ]);
});

describeDb('after somebody is removed from a farm', () => {
  /**
   * The report, exactly: a 409 before the fix and a farm after it.
   *
   * 201 rather than 200 — `/auth/signup` creates something and says so, and it
   * signs them in on the same response so there is no sign-in screen between a
   * farm being made and it being usable.
   */
  it('lets them start a farm of their own with the same address', async () => {
    const app = await server();
    await removeTheHand(app);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        orgId: ulid(),
        orgName: 'A farm of my own',
        email: HAND_EMAIL,
        password: PASSWORD,
        name: 'The hand',
      },
    });

    expect(res.statusCode).toBe(201);
    await app.close();
  });

  /**
   * And the new account really is a new one — a different farm, not a way back
   * into the old.
   */
  it('puts them on their own farm rather than the one they left', async () => {
    const app = await server();
    const { verifyAccessToken } = await import('@homefarm/api/auth/tokens');
    await removeTheHand(app);

    const mine = ulid();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        orgId: mine,
        orgName: 'A farm of my own',
        email: HAND_EMAIL,
        password: PASSWORD,
        name: 'The hand',
      },
    });

    const claims = await verifyAccessToken(res.json().accessToken, SECRET);
    expect(claims.orgId).toBe(mine);
    expect(claims.orgId).not.toBe(ORG);
    expect(claims.role).toBe('owner');
    await app.close();
  });

  /**
   * Releasing the address must not become a way back in. The old row is
   * disabled and its password is unchanged; it simply no longer answers to
   * that address.
   */
  it('does not let the old credentials reach the farm they left', async () => {
    const app = await server();
    await removeTheHand(app);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: HAND_EMAIL, password: PASSWORD },
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  /**
   * The farm keeps its history. A morning's egg logs do not stop being true
   * because the person who typed them left, and "who was that?" is a question
   * somebody asks — so the list still shows the address rather than the
   * `removed:<id>` token that took its place.
   */
  it('still shows the farm who it was', async () => {
    const app = await server();
    await removeTheHand(app);

    const res = await app.inject({
      method: 'GET',
      url: '/members',
      headers: { authorization: `Bearer ${await ownerToken(app)}` },
    });

    const hand = res.json().members.find((m: { id: string }) => m.id === HAND);
    expect(hand).toMatchObject({ name: 'The hand', email: HAND_EMAIL, disabled: true });
    await app.close();
  });

  /**
   * Google's subject id goes with the address, or the release is half a
   * release: `findUserByGoogleSub` would still find the disabled row and 401,
   * having freed an address that person never used to sign in.
   */
  it('releases the Google identity too', async () => {
    if (!harness) return;
    const app = await server();

    await harness.db
      .collection<UserDoc>('users')
      .updateOne({ _id: HAND }, { $set: { googleSub: 'google-subject-for-the-hand' } });

    await removeTheHand(app);

    const row = await harness.db.collection<UserDoc>('users').findOne({ _id: HAND });
    expect(row?.googleSub).toBeUndefined();
    expect(row?.formerGoogleSub).toBe('google-subject-for-the-hand');
    await app.close();
  });

  /**
   * Two people removed from one farm, which is where a naive fix breaks: the
   * unique index on `email` is not sparse, so unsetting the field would leave
   * both rows holding `null` and the second removal would fail outright.
   */
  it('can remove a second person after the first', async () => {
    if (!harness) return;
    const app = await server();

    const second = ulid();
    const { hashPassword } = await import('@homefarm/api/auth/password');
    await harness.db.collection<UserDoc>('users').insertOne({
      _id: second,
      email: `second-${second}@example.test`.toLowerCase(),
      passwordHash: await hashPassword(PASSWORD),
      name: 'Another hand',
      orgId: ORG,
      role: 'hand',
      createdAt: new Date(),
    });

    await removeTheHand(app);

    const res = await app.inject({
      method: 'DELETE',
      url: `/members/${second}`,
      headers: { authorization: `Bearer ${await ownerToken(app)}` },
    });

    expect(res.statusCode).toBe(204);
    await app.close();
  });
});

/**
 * ── "Access ends immediately" ──────────────────────────────────────────────
 *
 * `identity.ts` says it of removal, and it was not true. `requireMutationClaims`
 * refused a disabled account on every write, but the READ path —
 * `requireClaims` — verified the token's signature and stopped there, on the
 * documented ground that a signature *"is enough to decide what to render"*.
 *
 * What that rendered was every read route on this server: `GET /snapshot`, a
 * **whole-farm export**, plus the photos, the roster, the join codes and the
 * subscription. So somebody removed from a farm kept all of it for the rest of
 * their access token's fifteen minutes — and a removal made for cause is the
 * one where those fifteen minutes are the whole point.
 *
 * The token here is minted BEFORE the removal, deliberately. A token taken
 * afterwards would be refused at login for a different reason and would prove
 * nothing about the window.
 */
describeDb('the access a removed member still holds', () => {
  /** Their own token, taken while they were still a member of the farm. */
  async function handTokenBeforeRemoval(
    app: Awaited<ReturnType<typeof server>>,
  ): Promise<{ access: string; refresh: string }> {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: HAND_EMAIL, password: PASSWORD },
    });
    return { access: res.json().accessToken, refresh: res.json().refreshToken };
  }

  /** The largest response this API produces, and the one that mattered most. */
  it('cannot pull the farm out through the snapshot', async () => {
    const app = await server();
    const { access } = await handTokenBeforeRemoval(app);

    // It works while they are a member — otherwise this asserts nothing.
    const before = await app.inject({
      method: 'GET',
      url: '/snapshot',
      headers: { authorization: `Bearer ${access}` },
    });
    expect(before.statusCode).toBe(200);

    await removeTheHand(app);

    const after = await app.inject({
      method: 'GET',
      url: '/snapshot',
      headers: { authorization: `Bearer ${access}` },
    });
    expect(after.statusCode).toBe(401);
    await app.close();
  });

  /** The roster and the join codes go with it — a code is a way back in. */
  it('cannot read the roster or the join codes', async () => {
    const app = await server();
    const { access } = await handTokenBeforeRemoval(app);
    await removeTheHand(app);

    for (const url of ['/members', '/join-codes', '/billing']) {
      const res = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${access}` },
      });
      expect(res.statusCode, url).toBe(401);
    }
    await app.close();
  });

  /**
   * And the refresh family is actually dead rather than merely unusable.
   *
   * `disableUser` made the account unusable and left the tokens alive; every
   * gate happened to refuse a disabled user, so nothing was reachable through
   * them — but a defence resting on one field being checked in one function is
   * one refactor from being no defence at all. `revokeAllForUser` is what a
   * password reset already does for exactly this reason.
   */
  it('has its refresh tokens revoked, not just refused', async () => {
    if (!harness) return;
    const app = await server();
    const { refresh } = await handTokenBeforeRemoval(app);

    await removeTheHand(app);

    const live = await harness.db
      .collection('refreshTokens')
      .countDocuments({ userId: HAND, revokedAt: { $exists: false } });
    expect(live).toBe(0);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: refresh },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  /**
   * The owner is untouched. A check added to the read path is a check that can
   * lock out the farm, so this is the assertion that says it did not.
   */
  it('leaves everybody else reading exactly as before', async () => {
    const app = await server();
    await removeTheHand(app);

    const res = await app.inject({
      method: 'GET',
      url: '/snapshot',
      headers: { authorization: `Bearer ${await ownerToken(app)}` },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
