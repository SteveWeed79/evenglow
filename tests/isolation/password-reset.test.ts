import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { RESET_MAX_ATTEMPTS, normalizeResetCode } from '@steading/contracts';
import type { UserDoc } from '@steading/api/db/identity';
import { startTestDb } from '../support/mongo';

/**
 * Getting back in, and the ways it must refuse.
 *
 * `PASSWORD-RECOVERY.md` §11 lists what has to be tested and this is that list,
 * assembled before the code was written rather than remembered after it. The
 * two worth naming here:
 *
 * **The timing envelope.** `/auth/forgot` answering the same *words* for a real
 * and an unknown address is the easy half; answering in the same *time* is the
 * half implementations skip, and without it the route enumerates accounts by
 * stopwatch — a real account does an argon2 hash, a database write and an HTTP
 * call, and an unknown one returns immediately.
 *
 * **Revoking every session.** A reset is what somebody does when they think
 * another person has their password. Leaving that person's refresh token alive
 * defeats the entire exercise, and it is invisible: the owner's password
 * changed, so everything looks fixed.
 */

const harness = await startTestDb('steading_password_reset');

if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'steading_password_reset';
}

const describeDb = harness ? describe : describe.skip;

const SECRET = 'a-test-secret-long-enough-for-hs256-abcdef';
const OLD_PASSWORD = 'the-old-password-here';
const NEW_PASSWORD = 'a-brand-new-password';

const ORG = ulid();
const USER = ulid();
const EMAIL = 'keeper@example.test';

/**
 * The `log` provider, so the flow runs end to end without a network call and
 * without pretending an unconfigured server can send. Choosing it is explicit,
 * exactly as a development box would have to.
 */
const MAIL = { EMAIL_PROVIDER: 'log', EMAIL_FROM: 'Evenglow <hello@example.test>' };

async function buildApp(over: Record<string, string> = {}) {
  const { buildServer } = await import('@steading/api/server');
  const { readEnv } = await import('@steading/api/env');
  return buildServer(
    readEnv({
      AUTH_SECRET: SECRET,
      MONGODB_URI: harness!.uri,
      MONGODB_DB: 'steading_password_reset',
      ...MAIL,
      ...over,
    }),
  );
}

async function post(path: string, payload: unknown, over: Record<string, string> = {}) {
  const app = await buildApp(over);
  const res = await app.inject({ method: 'POST', url: path, payload: payload as never });
  await app.close();
  return { status: res.statusCode, body: res.body };
}

/** The code as it was minted, read from the only place it exists in the clear. */
async function theCode(): Promise<string> {
  const { mintResetCode } = await import('@steading/api/db/password-resets');
  // Not readable from the row by design — the row holds a SHA-256. So the
  // suite mints its own and installs it, which is what a test of redemption
  // needs and what a test of storage must never be able to do.
  return mintResetCode();
}

async function installCode(code: string, over: Partial<{ expiresAt: Date; attempts: number }> = {}) {
  const { hashResetCode, replaceResetCode } = await import('@steading/api/db/password-resets');
  const now = new Date();
  await replaceResetCode({
    _id: hashResetCode(normalizeResetCode(code)),
    userId: USER,
    createdAt: now,
    expiresAt: over.expiresAt ?? new Date(now.getTime() + 20 * 60_000),
    attempts: over.attempts ?? 0,
  });
}

async function signedIn(): Promise<string> {
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: EMAIL, password: OLD_PASSWORD },
  });
  await app.close();
  return (JSON.parse(res.body) as { refreshToken: string }).refreshToken;
}

beforeEach(async () => {
  const { hashPassword } = await import('@steading/api/auth/password');
  const { insertOrg, insertUser } = await import('@steading/api/db/identity');

  for (const name of ['users', 'orgs', 'passwordResets', 'refreshTokens']) {
    await harness!.db.collection(name).deleteMany({});
  }

  await insertOrg({ _id: ORG, name: 'Hollow Farm', createdAt: new Date() });
  await insertUser({
    _id: USER,
    email: EMAIL,
    passwordHash: await hashPassword(OLD_PASSWORD),
    name: 'The keeper',
    orgId: ORG,
    role: 'owner',
    createdAt: new Date(),
    /**
     * Confirmed, because recovery now requires it (§10).
     *
     * Added to the seed rather than left off: every test below is about what
     * happens once somebody *can* be sent a code, and an unverified account is
     * sent nothing at all — so without this the whole suite would be asserting
     * the gate over and over instead of the flow behind it. The gate has its
     * own test, directly below the ones about asking.
     */
    emailVerifiedAt: new Date(),
  } satisfies UserDoc);
});

afterAll(async () => {
  await harness?.stop();
});

describeDb('asking for a code', () => {
  it('answers the same for an address with an account and one without', async () => {
    const known = await post('/auth/forgot', { email: EMAIL });
    const unknown = await post('/auth/forgot', { email: 'nobody@example.test' });

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toBe(unknown.body);
  });

  /**
   * The assertion §11 calls the one people skip.
   *
   * A generous bound rather than a tight one: this runs on shared CI hardware
   * and the point is that the two are the *same order of magnitude*, not that
   * they match to the millisecond. A route without the floor differs by the
   * cost of an argon2 hash plus a write — hundreds of milliseconds — which this
   * catches, while a slow runner does not fail it.
   */
  it('takes about as long either way', async () => {
    /**
     * **One app, injected into repeatedly**, and the first version of this test
     * built a fresh one per request — which cost hundreds of milliseconds of
     * Fastify construction and swamped the very difference being measured. It
     * passed with the timing floor removed, which is the worst way for a test
     * to pass. Caught by deleting the floor and watching it stay green.
     *
     * Three requests, which is exactly the per-minute limit — the warm-up plus
     * the two being compared. A fourth would be a 429, and a 429 is fast, which
     * would quietly turn this into a test of the limiter.
     */
    const app = await buildApp();
    const time = async (email: string) => {
      const started = process.hrtime.bigint();
      await app.inject({ method: 'POST', url: '/auth/forgot', payload: { email } });
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    // Warm: the first request pays for the Mongo connection, which is about
    // the process rather than about either account.
    await time(EMAIL);

    const known = await time(EMAIL);
    const unknown = await time('nobody@example.test');
    await app.close();

    // Both sit on the floor. Without it the known address pays for an argon2
    // hash, a write and a send, and the two diverge by hundreds of milliseconds.
    expect(known).toBeGreaterThan(500);
    expect(unknown).toBeGreaterThan(500);
    expect(Math.abs(known - unknown)).toBeLessThan(250);
  });

  it('writes a row for a real address and none for a stranger', async () => {
    await post('/auth/forgot', { email: 'nobody@example.test' });
    expect(await harness!.db.collection('passwordResets').countDocuments({})).toBe(0);

    await post('/auth/forgot', { email: EMAIL });
    expect(await harness!.db.collection('passwordResets').countDocuments({})).toBe(1);
  });

  /**
   * Never in the clear. Asserted against a code this suite knows, because the
   * route's own code is unknowable by design — which is the property being
   * tested, and a test that could read it would be testing the opposite.
   */
  it('stores no code anybody could read', async () => {
    const code = await theCode();
    await installCode(code);

    const row = await harness!.db.collection('passwordResets').findOne({ userId: USER });
    const serialised = JSON.stringify(row);

    expect(String(row?._id)).toHaveLength(64);
    expect(serialised).not.toContain(code);
    expect(serialised).not.toContain(normalizeResetCode(code));
  });

  /**
   * One *usable* code, which is not the same as one row — the older one is
   * retired and kept. Somebody who taps twice has one code that works, and it
   * is the one in the newest email.
   */
  it('leaves one usable code when asked twice, and it is the newer', async () => {
    await post('/auth/forgot', { email: EMAIL });
    const first = await harness!.db.collection('passwordResets').findOne({});

    await post('/auth/forgot', { email: EMAIL });
    const usable = await harness!.db
      .collection('passwordResets')
      .find({ usedAt: { $exists: false }, supersededAt: { $exists: false } })
      .toArray();

    expect(usable).toHaveLength(1);
    expect(String(usable[0]?._id)).not.toBe(String(first?._id));
    // And the older one is retired rather than gone.
    const retired = await harness!.db.collection('passwordResets').findOne({ _id: first!._id });
    expect(retired?.supersededAt).toBeInstanceOf(Date);
  });

  /**
   * The anti-harassment limit, which the per-IP limiter does not cover: somebody
   * who knows a farmer's address must not be able to fill their inbox from three
   * different networks.
   */
  it('stops sending to one account after three in an hour', async () => {
    for (let i = 0; i < 3; i += 1) await post('/auth/forgot', { email: EMAIL });
    expect(await harness!.db.collection('passwordResets').countDocuments({})).toBe(3);

    const answer = await post('/auth/forgot', { email: EMAIL });

    // Still answered 202 — saying "too many" would be a different answer for a
    // real address than for a stranger, which is the enumeration §5 removes.
    expect(answer.status).toBe(202);
    expect(await harness!.db.collection('passwordResets').countDocuments({})).toBe(3);
  });

  /**
   * **The gate email verification exists to install** (§10).
   *
   * An address nobody has proved they can read is sent nothing, because a typo
   * at signup would otherwise be a recovery route into a stranger's inbox — and
   * the farm cannot tell, since this route answers identically either way.
   *
   * Asserted through the *rows*, not the answer, precisely because the answer
   * must not change: a 202 that skipped the mint is what this looks like from
   * outside, and the row count is the only place the difference is visible.
   */
  it('sends nothing to an address nobody has confirmed', async () => {
    await harness!.db
      .collection('users')
      .updateOne({ _id: USER as never }, { $unset: { emailVerifiedAt: '' } });

    const answer = await post('/auth/forgot', { email: EMAIL });

    expect(answer.status).toBe(202);
    expect(await harness!.db.collection('passwordResets').countDocuments({})).toBe(0);

    // Identical to the answer a complete stranger gets, which is the property
    // that keeps this from disclosing which accounts are unconfirmed.
    const stranger = await post('/auth/forgot', { email: 'nobody@example.test' });
    expect(answer.body).toBe(stranger.body);
  });

  /**
   * A server that cannot send says so, and it is the one distinct refusal here
   * — it describes the server, is the same for every address, and discloses
   * nothing about accounts.
   */
  it('refuses cleanly when no mail is configured', async () => {
    const answer = await post('/auth/forgot', { email: EMAIL }, { EMAIL_FROM: '' });

    expect(answer.status).toBe(503);
    expect(await harness!.db.collection('passwordResets').countDocuments({})).toBe(0);
  });
});

describeDb('using a code', () => {
  it('changes the password, once', async () => {
    const code = await theCode();
    await installCode(code);

    const first = await post('/auth/reset', { email: EMAIL, code, password: NEW_PASSWORD });
    expect(first.status).toBe(204);

    const signIn = await post('/auth/login', { email: EMAIL, password: NEW_PASSWORD });
    expect(signIn.status).toBe(200);

    // A replay finds it spent.
    const again = await post('/auth/reset', { email: EMAIL, code, password: 'another-password-x' });
    expect(again.status).toBe(400);
  });

  it('refuses an expired code', async () => {
    const code = await theCode();
    await installCode(code, { expiresAt: new Date(Date.now() - 1000) });

    expect((await post('/auth/reset', { email: EMAIL, code, password: NEW_PASSWORD })).status).toBe(
      400,
    );
  });

  /**
   * The ceiling that makes the entropy argument academic. After five wrong
   * guesses the row is dead, so the *correct* code stops working too — which is
   * the point: an attacker cannot buy more attempts by waiting.
   */
  it('kills the code on the fifth wrong guess, correct one included', async () => {
    const code = await theCode();
    await installCode(code);

    for (let i = 0; i < RESET_MAX_ATTEMPTS; i += 1) {
      await post('/auth/reset', { email: EMAIL, code: 'WRONGWRO', password: NEW_PASSWORD });
    }

    expect((await post('/auth/reset', { email: EMAIL, code, password: NEW_PASSWORD })).status).toBe(
      400,
    );
    const signIn = await post('/auth/login', { email: EMAIL, password: NEW_PASSWORD });
    expect(signIn.status).toBe(401);
  });

  /**
   * **The write people leave out.** A reset is what somebody does when they
   * believe another person has their password; a session that survives it is
   * that person, still syncing, on an account its owner thinks they just
   * secured.
   */
  it('signs every other device out', async () => {
    const refreshToken = await signedIn();
    // It works before the reset, so the refusal afterwards is the reset's doing.
    expect((await post('/auth/refresh', { refreshToken })).status).toBe(200);

    const code = await theCode();
    await installCode(code);
    await post('/auth/reset', { email: EMAIL, code, password: NEW_PASSWORD });

    expect((await post('/auth/refresh', { refreshToken })).status).toBe(401);
  });

  /** Wrong code, unknown address, weak password — one sentence for all of them. */
  it('says one thing however it failed', async () => {
    const code = await theCode();
    await installCode(code);

    const wrongCode = await post('/auth/reset', { email: EMAIL, code: 'AAAAAAAA', password: NEW_PASSWORD });
    const unknown = await post('/auth/reset', { email: 'nobody@example.test', code, password: NEW_PASSWORD });
    const weak = await post('/auth/reset', { email: EMAIL, code, password: 'short' });

    for (const answer of [wrongCode, unknown, weak]) {
      expect(answer.status).toBe(400);
      expect(answer.body).toBe(wrongCode.body);
    }
  });

  /** Crockford folding, so `l` for `1` on a phone keyboard is understood. */
  it('understands a code typed with the ambiguous letters', async () => {
    const code = await theCode();
    await installCode(code);

    const typed = code.replace(/1/g, 'l').replace(/0/g, 'O').toLowerCase();
    expect((await post('/auth/reset', { email: EMAIL, code: typed, password: NEW_PASSWORD })).status)
      .toBe(204);
  });

  /**
   * A code minted for one account cannot be spent on another. The isolation
   * assertion §11 asks for: the collection is not tenant scoped, so nothing
   * structural stops this and the filter has to.
   */
  it('cannot be spent on somebody elses account', async () => {
    const { hashPassword } = await import('@steading/api/auth/password');
    const { insertOrg, insertUser } = await import('@steading/api/db/identity');
    const otherOrg = ulid();
    const other = ulid();
    await insertOrg({ _id: otherOrg, name: 'Far Field', createdAt: new Date() });
    await insertUser({
      _id: other,
      email: 'other@example.test',
      passwordHash: await hashPassword(OLD_PASSWORD),
      name: 'Somebody else',
      orgId: otherOrg,
      role: 'owner',
      createdAt: new Date(),
    } satisfies UserDoc);

    const code = await theCode();
    await installCode(code);

    const stolen = await post('/auth/reset', {
      email: 'other@example.test',
      code,
      password: NEW_PASSWORD,
    });

    expect(stolen.status).toBe(400);
    // And the account it was really for is untouched.
    expect((await post('/auth/login', { email: EMAIL, password: OLD_PASSWORD })).status).toBe(200);
  });
});
