import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ACCOUNT_DELETE_PATH, DELETION_REFUSED } from '@homefarm/contracts';
import type { OrgDoc, UserDoc } from '@homefarm/api/db/identity';
import { startTestDb } from '../support/mongo';

/**
 * Deleting an account, against a real database.
 *
 * `docs/ACCOUNT-DELETION.md` is the decision and `contracts/deletion.ts` the
 * rule: the last owner takes the farm, anybody else takes only themselves.
 * Three things are asserted here that nothing else can reach.
 *
 * **The neighbour is untouched.** This is the operation in the whole service
 * that deletes the most, so it is the one where an unscoped filter costs
 * somebody else's farm. `tests/unit/deletion-coverage.test.ts` proves the
 * filters carry a tenant key; this proves the records really are still there
 * afterwards, which is the claim that matters.
 *
 * **A session is not a proof.** A refresh token lifted from a device keystore
 * must not be enough to destroy two years of records, which is why the route
 * asks for the password on top of the token it already verified.
 *
 * **The web door enumerates nobody.** It is reachable by anyone with the URL —
 * Play requires exactly that — so a wrong password and an address with no
 * account have to be one sentence, the same rule sign-in follows.
 */

const harness = await startTestDb('homefarm_account_deletion');

if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'homefarm_account_deletion';
}

const describeDb = harness ? describe : describe.skip;

const SECRET = 'a-test-secret-long-enough-for-hs256-abcdef';
const PASSWORD = 'a properly long passphrase';

/** The farm being deleted, and the one that must survive it. */
const MINE = ulid();
const THEIRS = ulid();

const OWNER = ulid();
const HAND = ulid();
const NEIGHBOUR = ulid();

const OWNER_EMAIL = `owner-${OWNER}@example.test`.toLowerCase();
const HAND_EMAIL = `hand-${HAND}@example.test`.toLowerCase();
const NEIGHBOUR_EMAIL = `neighbour-${NEIGHBOUR}@example.test`.toLowerCase();

async function server() {
  const { buildServer } = await import('@homefarm/api/server');
  const { readEnv } = await import('@homefarm/api/env');
  return buildServer(
    readEnv({
      AUTH_SECRET: SECRET,
      MONGODB_URI: harness!.uri,
      MONGODB_DB: 'homefarm_account_deletion',
    }),
  );
}

type App = Awaited<ReturnType<typeof server>>;

async function tokenFor(app: App, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: PASSWORD },
  });
  expect(res.statusCode, `${email} could not sign in`).toBe(200);
  return res.json().accessToken;
}

/** The app's door: a session, plus a proof. */
async function deleteAsSignedIn(
  app: App,
  email: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method: 'POST',
    url: ACCOUNT_DELETE_PATH,
    headers: { authorization: `Bearer ${await tokenFor(app, email)}` },
    payload: body as never,
  });
  return { status: res.statusCode, body: res.json() };
}

/**
 * A collection whose `_id` is a ULID string, which every collection in this
 * service has. Typed here rather than at each call site: the driver's default
 * is `ObjectId`, and the alternative is a cast on every line.
 */
function rows(name: string) {
  return harness!.db.collection<{ _id: string; orgId?: string; [field: string]: unknown }>(name);
}

/** How many records one farm still has, across the collections it writes to. */
async function recordsIn(orgId: string): Promise<number> {
  let total = 0;
  for (const name of ['flocks', 'eggLogs', 'mutations', 'animals']) {
    total += await rows(name).countDocuments({ orgId });
  }
  return total;
}

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  if (!harness) return;
  const { hashPassword } = await import('@homefarm/api/auth/password');
  const hash = await hashPassword(PASSWORD);

  for (const name of [
    'users',
    'orgs',
    'refreshTokens',
    'flocks',
    'eggLogs',
    'mutations',
    'animals',
    'invites',
    'joinCodes',
    'photoBytes.files',
    'photoBytes.chunks',
  ]) {
    await harness.db.collection(name).deleteMany({});
  }

  await harness.db.collection<OrgDoc>('orgs').insertMany([
    { _id: MINE, name: 'Hollow Farm', createdAt: new Date() },
    { _id: THEIRS, name: 'The next farm over', createdAt: new Date() },
  ]);

  await harness.db.collection<UserDoc>('users').insertMany([
    {
      _id: OWNER,
      email: OWNER_EMAIL,
      passwordHash: hash,
      name: 'The owner',
      orgId: MINE,
      role: 'owner',
      createdAt: new Date(),
    },
    {
      _id: HAND,
      email: HAND_EMAIL,
      passwordHash: hash,
      name: 'The hand',
      orgId: MINE,
      role: 'hand',
      createdAt: new Date(),
    },
    {
      _id: NEIGHBOUR,
      email: NEIGHBOUR_EMAIL,
      passwordHash: hash,
      name: 'The neighbour',
      orgId: THEIRS,
      role: 'owner',
      createdAt: new Date(),
    },
  ]);

  // Records on both farms, so "the neighbour is untouched" has something to be
  // true about rather than being vacuously satisfied by an empty collection.
  for (const orgId of [MINE, THEIRS]) {
    await rows('flocks').insertOne({ _id: ulid(), orgId, name: 'The layers' });
    await rows('eggLogs').insertOne({ _id: ulid(), orgId, count: 12 });
    await rows('mutations').insertOne({ _id: ulid(), orgId, entity: 'eggLog' });
    await rows('animals').insertOne({ _id: ulid(), orgId, name: 'Bramble' });
  }
});

describeDb('the last owner deleting their account', () => {
  it('takes the farm and says how many other accounts went with it', async () => {
    const app = await server();

    const { status, body } = await deleteAsSignedIn(app, OWNER_EMAIL, { password: PASSWORD });

    expect(status).toBe(200);
    // The hand, and nobody else — the number the owner was warned about.
    expect(body).toEqual({ deleted: 'farm', members: 1 });
    await app.close();
  });

  it('leaves none of the farm’s records behind', async () => {
    const app = await server();
    expect(await recordsIn(MINE)).toBeGreaterThan(0);

    await deleteAsSignedIn(app, OWNER_EMAIL, { password: PASSWORD });

    expect(await recordsIn(MINE)).toBe(0);
    expect(await rows('orgs').countDocuments({ _id: MINE })).toBe(0);
    await app.close();
  });

  /**
   * The assertion this file is named for. Every other one here would pass just
   * as well against a deletion that emptied the whole database.
   */
  it('does not touch the farm next door', async () => {
    const app = await server();
    const before = await recordsIn(THEIRS);

    await deleteAsSignedIn(app, OWNER_EMAIL, { password: PASSWORD });

    expect(await recordsIn(THEIRS)).toBe(before);
    expect(await rows('orgs').countDocuments({ _id: THEIRS })).toBe(1);
    // And their owner can still sign in, which is the version of it a person
    // would notice.
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: NEIGHBOUR_EMAIL, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  /** Everybody on it goes, or the farm's records outlive the farm in a token. */
  it('deletes the other members and their sessions', async () => {
    const app = await server();
    // A live session for the hand, taken before the farm goes.
    await tokenFor(app, HAND_EMAIL);

    await deleteAsSignedIn(app, OWNER_EMAIL, { password: PASSWORD });

    expect(await rows('users').countDocuments({ orgId: MINE })).toBe(0);
    expect(await rows('refreshTokens').countDocuments({ userId: HAND })).toBe(0);
    await app.close();
  });

  /** The address comes free, exactly as a removal releases one. */
  it('frees the address for a farm of their own', async () => {
    const app = await server();
    await deleteAsSignedIn(app, OWNER_EMAIL, { password: PASSWORD });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        orgId: ulid(),
        orgName: 'Starting again',
        email: OWNER_EMAIL,
        password: PASSWORD,
        name: 'The owner',
      },
    });

    expect(res.statusCode).toBe(201);
    await app.close();
  });
});

describeDb('somebody who is not the farm’s last owner', () => {
  it('takes only themselves, and the farm carries on', async () => {
    const app = await server();
    const before = await recordsIn(MINE);

    const { status, body } = await deleteAsSignedIn(app, HAND_EMAIL, { password: PASSWORD });

    expect(status).toBe(200);
    expect(body).toEqual({ deleted: 'member' });
    // The records stay: a morning's egg logs do not stop being true because
    // the person who typed them left.
    expect(await recordsIn(MINE)).toBe(before);
    expect(await rows('users').countDocuments({ _id: OWNER })).toBe(1);
    await app.close();
  });

  /**
   * Deleted rather than disabled, which is the difference between a removal and
   * leaving: removal keeps the row so the farm can say who typed a record, and
   * this is the person asking for their name to go.
   */
  it('leaves no row behind at all', async () => {
    const app = await server();
    await deleteAsSignedIn(app, HAND_EMAIL, { password: PASSWORD });

    expect(await rows('users').countDocuments({ _id: HAND })).toBe(0);
    await app.close();
  });

  /** An owner with a co-owner is in the same position. */
  it('is how an owner leaves when another owner remains', async () => {
    if (!harness) return;
    const app = await server();
    await harness.db.collection<UserDoc>('users').updateOne({ _id: HAND }, { $set: { role: 'owner' } });
    const before = await recordsIn(MINE);

    const { body } = await deleteAsSignedIn(app, OWNER_EMAIL, { password: PASSWORD });

    expect(body).toEqual({ deleted: 'member' });
    expect(await recordsIn(MINE)).toBe(before);
    await app.close();
  });
});

describeDb('the proof a deletion needs', () => {
  /**
   * The whole reason the password is asked for on a route that already verified
   * a token: a stolen session must not be able to destroy a farm.
   */
  it('refuses a session with no proof at all', async () => {
    const app = await server();

    const res = await app.inject({
      method: 'POST',
      url: ACCOUNT_DELETE_PATH,
      headers: { authorization: `Bearer ${await tokenFor(app, OWNER_EMAIL)}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(await recordsIn(MINE)).toBeGreaterThan(0);
    await app.close();
  });

  it('refuses a wrong password, and deletes nothing', async () => {
    const app = await server();

    const { status } = await deleteAsSignedIn(app, OWNER_EMAIL, {
      password: 'not the passphrase at all',
    });

    expect(status).toBe(403);
    expect(await recordsIn(MINE)).toBeGreaterThan(0);
    expect(await rows('orgs').countDocuments({ _id: MINE })).toBe(1);
    await app.close();
  });

  /**
   * The preview and the deletion are limited separately, and this is why.
   *
   * The screen asks the preview every time the panel is opened. On one shared
   * ceiling of five a minute, somebody who opened the panel, read the warning,
   * thought better of it and came back would find the deletion itself answered
   * *"Too many attempts"* — a refusal about nothing they did, on the one flow
   * where being unable to proceed is the complaint.
   */
  it('does not let reading the warning use up the deletion’s attempts', async () => {
    const app = await server();
    const token = await tokenFor(app, OWNER_EMAIL);

    // More than the deletion route's own ceiling.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const preview = await app.inject({
        method: 'GET',
        url: `${ACCOUNT_DELETE_PATH}/preview`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(preview.statusCode, `preview ${attempt} was refused`).toBe(200);
    }

    const res = await app.inject({
      method: 'POST',
      url: ACCOUNT_DELETE_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: { password: PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  /** And the preview says what the warning is built from. */
  it('says how many other accounts a deletion would take', async () => {
    const app = await server();

    const res = await app.inject({
      method: 'GET',
      url: `${ACCOUNT_DELETE_PATH}/preview`,
      headers: { authorization: `Bearer ${await tokenFor(app, OWNER_EMAIL)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ members: 1 });
    await app.close();
  });

  /** Nobody goes with a hand's deletion, and the warning must not claim otherwise. */
  it('counts nobody for somebody who is not the last owner', async () => {
    const app = await server();

    const res = await app.inject({
      method: 'GET',
      url: `${ACCOUNT_DELETE_PATH}/preview`,
      headers: { authorization: `Bearer ${await tokenFor(app, HAND_EMAIL)}` },
    });

    expect(res.json()).toEqual({ members: 0 });
    await app.close();
  });

  it('refuses a caller with no session and no credentials', async () => {
    const app = await server();

    const res = await app.inject({ method: 'POST', url: ACCOUNT_DELETE_PATH, payload: {} });

    expect(res.statusCode).toBe(401);
    expect(await recordsIn(MINE)).toBeGreaterThan(0);
    await app.close();
  });
});

describeDb('the web door, which needs no app', () => {
  it('serves a page anybody can reach', async () => {
    const app = await server();

    const res = await app.inject({ method: 'GET', url: ACCOUNT_DELETE_PATH });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    // The warning is the point of the page; a form without it is worse than no
    // page at all.
    expect(res.body).toContain('deletes the farm');
    await app.close();
  });

  /** Its content policy, which is what stops an injected script running. */
  it('names a nonce and refuses everything else', async () => {
    const app = await server();
    const res = await app.inject({ method: 'GET', url: ACCOUNT_DELETE_PATH });

    const policy = String(res.headers['content-security-policy']);
    expect(policy).toContain("default-src 'none'");
    expect(policy).toMatch(/script-src 'nonce-[\w-]+'/);
    // And the page carries the same one, or its own script never runs.
    const nonce = /script-src 'nonce-([\w-]+)'/.exec(policy)?.[1];
    expect(res.body).toContain(`<script nonce="${nonce}">`);
    await app.close();
  });

  it('deletes on an email and password, with no session anywhere', async () => {
    const app = await server();

    const res = await app.inject({
      method: 'POST',
      url: ACCOUNT_DELETE_PATH,
      payload: { email: OWNER_EMAIL, password: PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 'farm', members: 1 });
    expect(await recordsIn(MINE)).toBe(0);
    await app.close();
  });

  /**
   * One sentence for a wrong password and for an address nobody has, because a
   * page anybody can reach must not become the account enumerator that sign-in
   * refuses to be.
   */
  it('says the same thing about a wrong password and an unknown address', async () => {
    const app = await server();

    const wrong = await app.inject({
      method: 'POST',
      url: ACCOUNT_DELETE_PATH,
      payload: { email: OWNER_EMAIL, password: 'not the passphrase at all' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: ACCOUNT_DELETE_PATH,
      payload: { email: 'nobody@example.test', password: PASSWORD },
    });

    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: DELETION_REFUSED });
    expect(unknown.json()).toEqual(wrong.json());
    expect(await recordsIn(MINE)).toBeGreaterThan(0);
    await app.close();
  });
});
