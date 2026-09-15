import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGE_NOT_CONFIRMED } from '@homefarm/contracts';
import type { UserDoc } from '@homefarm/api/db/identity';
import { startTestDb } from '../support/mongo';

/**
 * The age floor, on every door that makes an account — `UNCONSIDERED.md` `[3]`.
 *
 * **The claim existed before the check did.** The privacy policy and the terms
 * both said an account needs somebody of thirteen or over, the app asked
 * nothing, and the Play Console asks the same question a third time. A
 * declaration that disagrees with the app is enforcement rather than
 * rejection, so what this suite is really testing is that a sentence in a
 * document is now a description of something the server does.
 *
 * ## Why it enumerates the doors
 *
 * There are four ways to end up with an account — signup, a join code, an
 * invitation, and a first Google sign-in — and three of them are easy to
 * forget, because only the first looks like "signing up". A gate on one door
 * is not a gate. Each is asserted separately here rather than through a
 * helper, so a fifth door added later fails this file by being absent from it.
 *
 * ## The one that is not parsing
 *
 * Three doors are closed by Zod: the assertion is `z.literal(true)` on their
 * schemas, so a body without it never reaches a handler. `/auth/google` cannot
 * be, because the same body signs somebody in — see `googleSignInSchema`. That
 * branch is checked in the route, which makes it the one that can rot, so it
 * gets both halves: that creating without the assertion is refused, and that
 * **signing in without it still works**.
 */

const stub = vi.hoisted(() => ({ verify: vi.fn() }));

vi.mock('@homefarm/api/auth/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@homefarm/api/auth/google')>()),
  verifyGoogleIdToken: stub.verify,
}));

const harness = await startTestDb('homefarm_age_gate');

if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'homefarm_age_gate';
}

const SECRET = 'a-test-secret-long-enough-for-hs256-abcdef';
const PASSWORD = 'a properly long passphrase';

const describeDb = harness ? describe : describe.skip;

async function server() {
  const { buildServer } = await import('@homefarm/api/server');
  const { readEnv } = await import('@homefarm/api/env');
  return buildServer(
    readEnv({
      AUTH_SECRET: SECRET,
      MONGODB_URI: harness!.uri,
      MONGODB_DB: 'homefarm_age_gate',
      GOOGLE_CLIENT_IDS: '123-android.apps.googleusercontent.com',
    }),
  );
}

function users() {
  return harness!.db.collection<UserDoc>('users');
}

/** A signup body, with the assertion unless a case takes it away. */
function claim(over: Record<string, unknown> = {}) {
  return {
    orgId: ulid(),
    orgName: 'A New Farm',
    email: `new-${ulid()}@example.test`.toLowerCase(),
    password: PASSWORD,
    name: 'Sam',
    ageConfirmed: true,
    ...over,
  };
}

/** An owner with a farm, for the invitations and join codes to hang off. */
async function farmWithOwner(): Promise<{ orgId: string; token: string }> {
  const { hashPassword } = await import('@homefarm/api/auth/password');
  const { insertOrg, insertUser } = await import('@homefarm/api/db/identity');
  const { startSession } = await import('@homefarm/api/auth/refresh');

  const orgId = ulid();
  const userId = ulid();

  await insertOrg({ _id: orgId, name: 'The Old Farm', createdAt: new Date() });
  await insertUser({
    _id: userId,
    email: `owner-${userId}@example.test`.toLowerCase(),
    passwordHash: await hashPassword(PASSWORD),
    name: 'The owner',
    orgId,
    role: 'owner',
    createdAt: new Date(),
  });

  const { accessToken } = await startSession({ userId, orgId, role: 'owner' }, SECRET);
  return { orgId, token: `Bearer ${accessToken}` };
}

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  stub.verify.mockReset();
  if (!harness) return;
  for (const name of ['refreshTokens', 'users', 'orgs', 'invites', 'joinCodes']) {
    await harness.db.collection(name).deleteMany({});
  }
  const { applyIndexes } = await import('@homefarm/api/db/indexes');
  await applyIndexes(harness.db);
});

describeDb('claiming a farm', () => {
  it('refuses a body that asserts nothing, and leaves no account behind', async () => {
    const app = await server();
    const { ageConfirmed, ...withoutIt } = claim();
    expect(ageConfirmed).toBe(true);

    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: withoutIt });

    expect(res.statusCode).toBe(400);
    // Not merely refused — nothing was written. A half-made account would be
    // the worse failure, because the next attempt would 409 on its own email.
    expect(await users().countDocuments({ email: withoutIt.email })).toBe(0);
    await app.close();
  });

  /**
   * `false` and absent are the same answer, and both have to be.
   *
   * A boolean field would have let `false` through to a handler that forgot to
   * look. `z.literal(true)` is what makes "somebody said no" unrepresentable
   * on the wire rather than merely unhandled.
   */
  it('refuses a body that asserts no', async () => {
    const app = await server();

    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: claim({ ageConfirmed: false }),
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  /**
   * What is kept is the moment, and there is no date of birth anywhere near
   * it. Holding one to enforce a rule about holding personal data would owe
   * the policy a retention line of its own.
   */
  it('records when the assertion was made, and not what it said', async () => {
    const app = await server();
    const payload = claim();

    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload });
    expect(res.statusCode).toBe(201);

    const made = await users().findOne({ email: payload.email });
    expect(made?.ageAssertedAt).toBeInstanceOf(Date);
    expect(Object.keys(made ?? {})).not.toContain('dateOfBirth');
    await app.close();
  });
});

describeDb('the other three doors', () => {
  it('refuses a join code redeemed without the assertion', async () => {
    const app = await server();
    const { token } = await farmWithOwner();

    const minted = await app.inject({
      method: 'POST',
      url: '/join-codes',
      headers: { authorization: token },
      payload: { role: 'hand' },
    });
    const code = minted.json().code as string;

    const email = `hand-${ulid()}@example.test`.toLowerCase();
    const res = await app.inject({
      method: 'POST',
      url: '/join-codes/redeem',
      payload: { code, email, password: PASSWORD, name: 'Pat' },
    });

    expect(res.statusCode).toBe(400);
    expect(await users().countDocuments({ email })).toBe(0);

    // And the code was not spent by the refusal — it is still good for the
    // same person once they have answered.
    const second = await app.inject({
      method: 'POST',
      url: '/join-codes/redeem',
      payload: { code, email, password: PASSWORD, name: 'Pat', ageConfirmed: true },
    });
    expect(second.statusCode).toBe(201);
    await app.close();
  });

  it('refuses an invitation accepted without the assertion', async () => {
    const app = await server();
    const { token } = await farmWithOwner();
    const email = `invited-${ulid()}@example.test`.toLowerCase();

    const invited = await app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: token },
      payload: { email, role: 'hand' },
    });
    const link = invited.json().token as string;

    const res = await app.inject({
      method: 'POST',
      url: '/invites/accept',
      payload: { token: link, email, password: PASSWORD, name: 'Sam' },
    });

    expect(res.statusCode).toBe(400);
    expect(await users().countDocuments({ email })).toBe(0);
    await app.close();
  });

  it('refuses a first Google sign-in that would create an account', async () => {
    const app = await server();
    const email = `google-${ulid()}@example.test`.toLowerCase();
    stub.verify.mockResolvedValue({ googleSub: 'sub-new', email, name: 'Sam' });
    const orgId = ulid();

    const res = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: 'anything', orgId, orgName: 'A New Farm' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: AGE_NOT_CONFIRMED });

    /**
     * Refused before the org was made, which is the ordering that matters.
     * `/auth/signup` has to take an empty org back out when the user insert
     * loses the email race; refusing above `insertOrg` means there is nothing
     * to take out.
     */
    expect(await harness!.db.collection('orgs').countDocuments({ _id: orgId as never })).toBe(0);
    expect(await users().countDocuments({ email })).toBe(0);
    await app.close();
  });

  it('records the assertion when a Google sign-in does create one', async () => {
    const app = await server();
    const email = `google-${ulid()}@example.test`.toLowerCase();
    stub.verify.mockResolvedValue({ googleSub: 'sub-new', email, name: 'Sam' });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: 'anything', orgId: ulid(), orgName: 'A New Farm', ageConfirmed: true },
    });

    expect(res.statusCode).toBe(201);
    expect((await users().findOne({ email }))?.ageAssertedAt).toBeInstanceOf(Date);
    await app.close();
  });
});

/**
 * The regression the optional field exists to prevent, and the reason this
 * suite is worth its length.
 *
 * `/auth/google` is one route for two operations. Requiring the assertion on
 * its schema would have shut a farmer of forty out of their own account on a
 * second phone — and would have done it to every build already on a handset,
 * on the route somebody uses to get back in. Nothing about signing in may
 * depend on this field.
 */
describeDb('signing in is not creating', () => {
  it('lets an existing Google account sign in with no assertion at all', async () => {
    const { hashPassword } = await import('@homefarm/api/auth/password');
    const { insertOrg, insertUser } = await import('@homefarm/api/db/identity');

    const orgId = ulid();
    const userId = ulid();
    const email = `back-${userId}@example.test`.toLowerCase();

    await insertOrg({ _id: orgId, name: 'Hollow Farm', createdAt: new Date() });
    await insertUser({
      _id: userId,
      email,
      passwordHash: await hashPassword(PASSWORD),
      googleSub: 'sub-known',
      emailVerifiedAt: new Date(),
      name: 'Sam',
      orgId,
      role: 'owner',
      createdAt: new Date(),
    });

    stub.verify.mockResolvedValue({ googleSub: 'sub-known', email, name: 'Sam' });
    const app = await server();

    // With the org fields a device holding an unclaimed farm would send, which
    // is the case that made "require it whenever orgId is present" wrong.
    const res = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: 'anything', orgId: ulid(), orgName: 'Ignored' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toBeTypeOf('string');
    await app.close();
  });

  /** And the password door is untouched: sign-in never asks. */
  it('lets an existing password account sign in with no assertion at all', async () => {
    const app = await server();
    const payload = claim();

    expect((await app.inject({ method: 'POST', url: '/auth/signup', payload })).statusCode).toBe(201);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: payload.email, password: PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
