import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { UserDoc } from '@steading/api/db/identity';
import { startTestDb } from '../support/mongo';

/**
 * Invites and membership, across a tenancy boundary.
 *
 * `invites` is the fourth collection `scoped()` cannot protect — the whole
 * point of an invite is that it is redeemed by somebody who has no session and
 * therefore no orgId. The org filter is written by hand in every query in
 * `db/invites.ts`, and hand-written is exactly what this file exists to check.
 *
 * The rule everywhere: a resource in another farm answers **404, never 403**.
 * A 403 confirms the thing exists, which is the disclosure the isolation rule
 * is about.
 */

const harness = await startTestDb('steading_invites');

if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'steading_invites';
}

const SECRET = 'a-test-secret-long-enough-for-hs256-abcdef';
const PASSWORD = 'a properly long passphrase';

const ORG_A = ulid();
const ORG_B = ulid();

const OWNER_A = ulid();
const HAND_A = ulid();
const OWNER_B = ulid();

const email = (id: string): string => `u-${id}@example.test`.toLowerCase();

const describeDb = harness ? describe : describe.skip;

async function server() {
  const { buildServer } = await import('@steading/api/server');
  const { readEnv } = await import('@steading/api/env');
  return buildServer(
    readEnv({
      AUTH_SECRET: SECRET,
      MONGODB_URI: harness!.uri,
      MONGODB_DB: 'steading_invites',
      CORS_ORIGINS: 'https://app.test',
    }),
  );
}

/** A real access token, minted the way sign-in mints one. */
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

  await harness.db.collection('invites').deleteMany({});
  await harness.db.collection('refreshTokens').deleteMany({});
  await harness.db.collection<UserDoc>('users').deleteMany({});
  await harness.db.collection('orgs').deleteMany({});

  await harness.db.collection('orgs').insertMany([
    { _id: ORG_A, name: 'Hollow Farm', createdAt: new Date() },
    { _id: ORG_B, name: 'Other Farm', createdAt: new Date() },
  ] as never);

  await harness.db.collection<UserDoc>('users').insertMany([
    { _id: OWNER_A, email: email(OWNER_A), passwordHash: hash, name: 'Owner A', orgId: ORG_A, role: 'owner', createdAt: new Date() },
    { _id: HAND_A, email: email(HAND_A), passwordHash: hash, name: 'Hand A', orgId: ORG_A, role: 'hand', createdAt: new Date() },
    { _id: OWNER_B, email: email(OWNER_B), passwordHash: hash, name: 'Owner B', orgId: ORG_B, role: 'owner', createdAt: new Date() },
  ]);
});

/** Creates an invite on org A and returns both the secret and its public id. */
async function inviteOnA(app: Awaited<ReturnType<typeof server>>, to: string, role = 'hand') {
  const res = await app.inject({
    method: 'POST',
    url: '/invites',
    headers: { authorization: await tokenFor(OWNER_A, ORG_A, 'owner') },
    payload: { email: to, role },
  });
  const { token } = res.json();

  const list = await app.inject({
    method: 'GET',
    url: '/invites',
    headers: { authorization: await tokenFor(OWNER_A, ORG_A, 'owner') },
  });

  return { token, id: list.json().invites[0].id as string, status: res.statusCode };
}

describeDb('creating an invite', () => {
  it('returns the token exactly once and never stores it', async () => {
    const app = await server();
    const { token, status } = await inviteOnA(app, 'sam@example.test');

    expect(status).toBe(201);
    expect(token).toBeTypeOf('string');

    // What is on disk is a hash, not the secret.
    const stored = await harness!.db.collection('invites').findOne({ orgId: ORG_A });
    expect(stored?._id).not.toBe(token);
    expect(JSON.stringify(stored)).not.toContain(token);

    // And listing pending invites never hands it back.
    const list = await app.inject({
      method: 'GET',
      url: '/invites',
      headers: { authorization: await tokenFor(OWNER_A, ORG_A, 'owner') },
    });
    expect(JSON.stringify(list.json())).not.toContain(token);
    await app.close();
  });

  it('refuses a hand', async () => {
    const app = await server();
    const res = await app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: await tokenFor(HAND_A, ORG_A, 'hand') },
      payload: { email: 'sam@example.test', role: 'hand' },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  /**
   * The escalation case, through the real route. The token says admin; the
   * database is what decides, and neither will mint an owner.
   */
  it('refuses an admin minting an owner', async () => {
    const app = await server();
    await harness!.db.collection<UserDoc>('users').updateOne({ _id: HAND_A }, { $set: { role: 'admin' } });

    const res = await app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: await tokenFor(HAND_A, ORG_A, 'admin') },
      payload: { email: 'sam@example.test', role: 'owner' },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  /**
   * Invariant 8, at the one route where getting it wrong grants farm access.
   * A token minted while someone was an owner must not outlive the demotion.
   */
  it('re-derives the role from the database, not the token', async () => {
    const app = await server();
    // A stale token claiming owner, for an account that is now a hand.
    const stale = await tokenFor(HAND_A, ORG_A, 'owner');

    const res = await app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: stale },
      payload: { email: 'sam@example.test', role: 'hand' },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describeDb('across the tenancy boundary', () => {
  it('never lists another farm’s invites', async () => {
    const app = await server();
    await inviteOnA(app, 'sam@example.test');

    const res = await app.inject({
      method: 'GET',
      url: '/invites',
      headers: { authorization: await tokenFor(OWNER_B, ORG_B, 'owner') },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().invites).toEqual([]);
    await app.close();
  });

  /** 404, never 403 — a 403 would confirm the invite exists. */
  it('answers 404 when another farm tries to revoke an invite', async () => {
    const app = await server();
    const { id } = await inviteOnA(app, 'sam@example.test');

    const res = await app.inject({
      method: 'DELETE',
      url: `/invites/${id}`,
      headers: { authorization: await tokenFor(OWNER_B, ORG_B, 'owner') },
    });

    expect(res.statusCode).toBe(404);

    // And it really is still live for the farm that owns it.
    const mine = await app.inject({
      method: 'DELETE',
      url: `/invites/${id}`,
      headers: { authorization: await tokenFor(OWNER_A, ORG_A, 'owner') },
    });
    expect(mine.statusCode).toBe(204);
    await app.close();
  });

  it('answers 404 when another farm tries to change a member’s role', async () => {
    const app = await server();
    const res = await app.inject({
      method: 'PATCH',
      url: `/members/${HAND_A}/role`,
      headers: { authorization: await tokenFor(OWNER_B, ORG_B, 'owner') },
      payload: { role: 'owner' },
    });

    expect(res.statusCode).toBe(404);

    const after = await harness!.db.collection<UserDoc>('users').findOne({ _id: HAND_A });
    expect(after?.role).toBe('hand');
    await app.close();
  });

  it('answers 404 when another farm tries to remove a member', async () => {
    const app = await server();
    const res = await app.inject({
      method: 'DELETE',
      url: `/members/${HAND_A}`,
      headers: { authorization: await tokenFor(OWNER_B, ORG_B, 'owner') },
    });

    expect(res.statusCode).toBe(404);
    const after = await harness!.db.collection<UserDoc>('users').findOne({ _id: HAND_A });
    expect(after?.disabledAt).toBeUndefined();
    await app.close();
  });

  it('never lists another farm’s members', async () => {
    const app = await server();
    const res = await app.inject({
      method: 'GET',
      url: '/members',
      headers: { authorization: await tokenFor(OWNER_B, ORG_B, 'owner') },
    });

    const ids = res.json().members.map((m: { id: string }) => m.id);
    expect(ids).toEqual([OWNER_B]);
    await app.close();
  });
});

describeDb('accepting', () => {
  it('joins the farm the invite came from, at the role it named', async () => {
    const app = await server();
    const { token } = await inviteOnA(app, 'sam@example.test');

    const res = await app.inject({
      method: 'POST',
      url: '/invites/accept',
      payload: { token, email: 'sam@example.test', password: 'a properly long one', name: 'Sam' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().accessToken).toBeTypeOf('string');

    const joined = await harness!.db.collection<UserDoc>('users').findOne({ email: 'sam@example.test' });
    expect(joined?.orgId).toBe(ORG_A);
    expect(joined?.role).toBe('hand');
    await app.close();
  });

  /**
   * The binding that makes a leaked link safe. The token proves someone has
   * the link; the email proves they are who it was for.
   */
  it('refuses a different email with a valid token', async () => {
    const app = await server();
    const { token } = await inviteOnA(app, 'sam@example.test');

    const res = await app.inject({
      method: 'POST',
      url: '/invites/accept',
      payload: { token, email: 'someone@else.test', password: 'a properly long one', name: 'Nope' },
    });

    expect(res.statusCode).toBe(404);
    expect(await harness!.db.collection<UserDoc>('users').findOne({ email: 'someone@else.test' })).toBeNull();
    await app.close();
  });

  /** Single use. The guard is in the update filter, so a race cannot double it. */
  it('refuses a second acceptance of the same link', async () => {
    const app = await server();
    const { token } = await inviteOnA(app, 'sam@example.test');
    const payload = { token, email: 'sam@example.test', password: 'a properly long one', name: 'Sam' };

    expect((await app.inject({ method: 'POST', url: '/invites/accept', payload })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/invites/accept', payload })).statusCode).toBe(404);

    const count = await harness!.db.collection<UserDoc>('users').countDocuments({ email: 'sam@example.test' });
    expect(count).toBe(1);
    await app.close();
  });

  it('refuses a revoked link', async () => {
    const app = await server();
    const { token, id } = await inviteOnA(app, 'sam@example.test');

    await app.inject({
      method: 'DELETE',
      url: `/invites/${id}`,
      headers: { authorization: await tokenFor(OWNER_A, ORG_A, 'owner') },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/invites/accept',
      payload: { token, email: 'sam@example.test', password: 'a properly long one', name: 'Sam' },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  /**
   * A user belongs to one org, so accepting would MOVE an existing account and
   * strand every record it wrote behind a tenancy boundary it no longer sits
   * inside. Refused rather than silently destructive.
   */
  it('refuses an account that already exists, and does not move it', async () => {
    const app = await server();
    const { token } = await inviteOnA(app, email(OWNER_B));

    const res = await app.inject({
      method: 'POST',
      url: '/invites/accept',
      payload: { token, email: email(OWNER_B), password: 'a properly long one', name: 'B' },
    });

    expect(res.statusCode).toBe(409);
    const b = await harness!.db.collection<UserDoc>('users').findOne({ _id: OWNER_B });
    expect(b?.orgId).toBe(ORG_B);
    expect(b?.role).toBe('owner');
    await app.close();
  });

  /** One answer for missing, revoked, used and expired. */
  it('says nothing about a token that does not exist', async () => {
    const app = await server();
    const res = await app.inject({
      method: 'GET',
      url: `/invites/${'z'.repeat(43)}`,
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describeDb('the last owner', () => {
  it('cannot be demoted', async () => {
    const app = await server();
    await harness!.db.collection<UserDoc>('users').updateOne({ _id: HAND_A }, { $set: { role: 'admin' } });

    const res = await app.inject({
      method: 'PATCH',
      url: `/members/${OWNER_A}/role`,
      headers: { authorization: await tokenFor(HAND_A, ORG_A, 'admin') },
      payload: { role: 'hand' },
    });

    expect(res.statusCode).toBe(403);
    const still = await harness!.db.collection<UserDoc>('users').findOne({ _id: OWNER_A });
    expect(still?.role).toBe('owner');
    await app.close();
  });

  it('cannot be removed', async () => {
    const app = await server();
    await harness!.db.collection<UserDoc>('users').updateOne({ _id: HAND_A }, { $set: { role: 'admin' } });

    const res = await app.inject({
      method: 'DELETE',
      url: `/members/${OWNER_A}`,
      headers: { authorization: await tokenFor(HAND_A, ORG_A, 'admin') },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  /** Removal is a disable, so the records they wrote stay attributable. */
  it('is removed by disabling, never by deleting', async () => {
    const app = await server();
    const res = await app.inject({
      method: 'DELETE',
      url: `/members/${HAND_A}`,
      headers: { authorization: await tokenFor(OWNER_A, ORG_A, 'owner') },
    });

    expect(res.statusCode).toBe(204);
    const gone = await harness!.db.collection<UserDoc>('users').findOne({ _id: HAND_A });
    expect(gone).not.toBeNull();
    expect(gone?.disabledAt).toBeInstanceOf(Date);
    await app.close();
  });
});
