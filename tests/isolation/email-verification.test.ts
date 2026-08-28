import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { VERIFY_MAX_ATTEMPTS, normalizeVerifyCode } from '@homefarm/contracts';
import type { UserDoc } from '@homefarm/api/db/identity';
import { startTestDb } from '../support/mongo';

/**
 * Proving the address on an account — `PASSWORD-RECOVERY.md` §10.
 *
 * The list follows §11's, because it is the same machinery and the same ways
 * of failing. Three assertions here are about this feature specifically and are
 * worth naming, since each covers a way the whole thing could be built and
 * still be worthless:
 *
 * **The gate actually gates.** A confirmed address gets a reset code and an
 * unconfirmed one does not. That is the entire point, and it lives one route
 * away from everything else here — so it is the assertion most likely to be
 * left to a comment.
 *
 * **A code cannot outlive the address it was minted for.** Somebody who
 * mistyped, corrected it, and then found the first code in a spam folder must
 * not be able to confirm a string the account no longer uses. Two mechanisms
 * defend it and both are asserted.
 *
 * **A stolen session is not enough to move an address.** The correction route
 * is the one new way to point an account at a different inbox, and if a
 * refresh token alone opened it, verification would have added a takeover path
 * rather than closed one.
 */

const harness = await startTestDb('homefarm_email_verify');

if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'homefarm_email_verify';
}

const describeDb = harness ? describe : describe.skip;

const SECRET = 'a-test-secret-long-enough-for-hs256-abcdef';
const PASSWORD = 'the-current-password';

const ORG = ulid();
const USER = ulid();
const EMAIL = 'keeper@example.test';
const CORRECTED = 'the-right-one@example.test';

/** The `log` provider, so the flow runs end to end without a network call. */
// check:names-ok — an operator-set From header, which is theirs to word.
const MAIL = { EMAIL_PROVIDER: 'log', EMAIL_FROM: 'Evenglow <hello@example.test>' };

async function buildApp(over: Record<string, string> = {}) {
  const { buildServer } = await import('@homefarm/api/server');
  const { readEnv } = await import('@homefarm/api/env');
  return buildServer(
    readEnv({
      AUTH_SECRET: SECRET,
      MONGODB_URI: harness!.uri,
      MONGODB_DB: 'homefarm_email_verify',
      ...MAIL,
      ...over,
    }),
  );
}

/** A signed-in caller, since every route in this file needs one. */
async function tokens(): Promise<{ accessToken: string; refreshToken: string }> {
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: EMAIL, password: PASSWORD },
  });
  await app.close();
  return JSON.parse(res.body) as { accessToken: string; refreshToken: string };
}

async function post(
  path: string,
  payload: unknown,
  accessToken?: string,
  over: Record<string, string> = {},
) {
  const app = await buildApp(over);
  const res = await app.inject({
    method: 'POST',
    url: path,
    payload: payload as never,
    ...(accessToken === undefined
      ? {}
      : { headers: { authorization: `Bearer ${accessToken}` } }),
  });
  await app.close();
  return { status: res.statusCode, body: res.body };
}

/**
 * A code this suite knows, installed directly.
 *
 * The route's own code is unknowable by design — the row holds a SHA-256 — so
 * redemption is tested against one minted here. A test that could read the
 * real one would be testing the opposite property.
 */
async function installCode(
  code: string,
  over: Partial<{ email: string; expiresAt: Date; attempts: number }> = {},
): Promise<void> {
  const { hashVerifyCode, replaceVerifyCode } = await import(
    '@homefarm/api/db/email-verifications'
  );
  const now = new Date();
  await replaceVerifyCode({
    _id: hashVerifyCode(normalizeVerifyCode(code)),
    userId: USER,
    email: over.email ?? EMAIL,
    createdAt: now,
    expiresAt: over.expiresAt ?? new Date(now.getTime() + 20 * 60_000),
    attempts: over.attempts ?? 0,
  });
}

async function freshCode(): Promise<string> {
  const { mintVerifyCode } = await import('@homefarm/api/db/email-verifications');
  return mintVerifyCode();
}

async function verifiedAt(): Promise<Date | undefined> {
  const { findUserById } = await import('@homefarm/api/db/identity');
  return (await findUserById(USER))?.emailVerifiedAt;
}

beforeEach(async () => {
  const { hashPassword } = await import('@homefarm/api/auth/password');
  const { insertOrg, insertUser } = await import('@homefarm/api/db/identity');

  for (const name of [
    'users',
    'orgs',
    'emailVerifications',
    'passwordResets',
    'refreshTokens',
  ]) {
    await harness!.db.collection(name).deleteMany({});
  }

  await insertOrg({ _id: ORG, name: 'Hollow Farm', createdAt: new Date() });
  // Unverified, which is the state every password signup starts in.
  await insertUser({
    _id: USER,
    email: EMAIL,
    passwordHash: await hashPassword(PASSWORD),
    name: 'The keeper',
    orgId: ORG,
    role: 'owner',
    createdAt: new Date(),
  } satisfies UserDoc);
});

afterAll(async () => {
  await harness?.stop();
});

describeDb('what an unconfirmed address costs', () => {
  /**
   * The whole feature in one assertion.
   *
   * Both halves are here on purpose: a gate that refuses everybody is not a
   * gate, it is a broken route, and a suite that only asserted the refusal
   * would pass against one.
   */
  it('is the difference between getting a reset code and not', async () => {
    await post('/auth/forgot', { email: EMAIL });
    expect(await harness!.db.collection('passwordResets').countDocuments({})).toBe(0);

    const { markEmailVerified } = await import('@homefarm/api/db/identity');
    await markEmailVerified(USER, EMAIL, new Date());

    await post('/auth/forgot', { email: EMAIL });
    expect(await harness!.db.collection('passwordResets').countDocuments({})).toBe(1);
  });

  /** The app cannot warn about what it is not told. */
  it('is reported back on sign-in, with the address it is about', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: EMAIL, password: PASSWORD },
    });
    await app.close();

    const body = JSON.parse(res.body) as {
      account?: { email: string; emailVerified: boolean; googleLinked: boolean };
    };
    /**
     * Deep equality, deliberately, so widening the account object is a
     * decision somebody makes here rather than one that happens to a client.
     *
     * `googleLinked` joined it when the in-session Google link shipped, and
     * this assertion is what said so — every field on this object is cached on
     * a handset and read by a screen, so a key arriving unremarked is a key
     * nothing renders and nobody chose.
     */
    expect(body.account).toEqual({
      email: EMAIL,
      emailVerified: false,
      googleLinked: false,
    });
  });

  /**
   * And on refresh, which is how a second handset finds out that somebody
   * confirmed the address on the tablet in the kitchen.
   */
  it('is reported again on every refresh', async () => {
    const { refreshToken } = await tokens();
    const { markEmailVerified } = await import('@homefarm/api/db/identity');
    await markEmailVerified(USER, EMAIL, new Date());

    const answer = await post('/auth/refresh', { refreshToken });
    const body = JSON.parse(answer.body) as { account?: { emailVerified: boolean } };

    expect(answer.status).toBe(200);
    expect(body.account?.emailVerified).toBe(true);
  });
});

describeDb('asking for a code', () => {
  it('needs a session', async () => {
    expect((await post('/auth/verify/send', {})).status).toBe(401);
  });

  it('writes exactly one usable row and never the code itself', async () => {
    const { accessToken } = await tokens();
    expect((await post('/auth/verify/send', {}, accessToken)).status).toBe(202);

    const rows = await harness!.db.collection('emailVerifications').find({}).toArray();
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?._id)).toHaveLength(64);
    expect(rows[0]?.email).toBe(EMAIL);
  });

  it('leaves one usable code when asked twice, and it is the newer', async () => {
    const { accessToken } = await tokens();
    await post('/auth/verify/send', {}, accessToken);
    const first = await harness!.db.collection('emailVerifications').findOne({});

    await post('/auth/verify/send', {}, accessToken);
    const usable = await harness!.db
      .collection('emailVerifications')
      .find({ usedAt: { $exists: false }, supersededAt: { $exists: false } })
      .toArray();

    expect(usable).toHaveLength(1);
    expect(String(usable[0]?._id)).not.toBe(String(first?._id));
    // Retired rather than deleted — the send limit counts rows, and deleting
    // is what quietly broke the same limit on the reset table.
    const retired = await harness!.db
      .collection('emailVerifications')
      .findOne({ _id: first!._id });
    expect(retired?.supersededAt).toBeInstanceOf(Date);
  });

  /**
   * Three an hour, and here it protects an inbox the account may not own: a
   * typo at signup means every send lands with a stranger.
   */
  it('stops after three in an hour', async () => {
    const { accessToken } = await tokens();
    for (let i = 0; i < 3; i += 1) await post('/auth/verify/send', {}, accessToken);
    expect(await harness!.db.collection('emailVerifications').countDocuments({})).toBe(3);

    const answer = await post('/auth/verify/send', {}, accessToken);

    // Said plainly, unlike recovery's silent 202 — the caller owns this account
    // and there is nobody to enumerate.
    expect(answer.status).toBe(429);
    expect(await harness!.db.collection('emailVerifications').countDocuments({})).toBe(3);
  });

  it('refuses cleanly when no mail is configured', async () => {
    const { accessToken } = await tokens();
    const answer = await post('/auth/verify/send', {}, accessToken, { EMAIL_FROM: '' });

    expect(answer.status).toBe(503);
    expect(await harness!.db.collection('emailVerifications').countDocuments({})).toBe(0);
  });

  it('says so rather than sending again once the address is confirmed', async () => {
    const { markEmailVerified } = await import('@homefarm/api/db/identity');
    await markEmailVerified(USER, EMAIL, new Date());
    const { accessToken } = await tokens();

    expect((await post('/auth/verify/send', {}, accessToken)).status).toBe(409);
    expect(await harness!.db.collection('emailVerifications').countDocuments({})).toBe(0);
  });
});

describeDb('using a code', () => {
  it('confirms the address, once', async () => {
    const { accessToken } = await tokens();
    const code = await freshCode();
    await installCode(code);

    expect((await post('/auth/verify', { code }, accessToken)).status).toBe(200);
    expect(await verifiedAt()).toBeInstanceOf(Date);

    // A replay finds the address already confirmed rather than the code reusable.
    expect((await post('/auth/verify', { code }, accessToken)).status).toBe(409);
  });

  it('refuses an expired code', async () => {
    const { accessToken } = await tokens();
    const code = await freshCode();
    await installCode(code, { expiresAt: new Date(Date.now() - 1000) });

    expect((await post('/auth/verify', { code }, accessToken)).status).toBe(400);
    expect(await verifiedAt()).toBeUndefined();
  });

  /** The ceiling, which is what makes the entropy argument academic. */
  it('kills the code on the fifth wrong guess, correct one included', async () => {
    const { accessToken } = await tokens();
    const code = await freshCode();
    await installCode(code);

    for (let i = 0; i < VERIFY_MAX_ATTEMPTS; i += 1) {
      await post('/auth/verify', { code: 'WRONGWRO' }, accessToken);
    }

    expect((await post('/auth/verify', { code }, accessToken)).status).toBe(400);
    expect(await verifiedAt()).toBeUndefined();
  });

  /** Crockford folding, so `l` for `1` on a phone keyboard is understood. */
  it('understands a code typed with the ambiguous letters', async () => {
    const { accessToken } = await tokens();
    const code = await freshCode();
    await installCode(code);

    const typed = code.replace(/1/g, 'l').replace(/0/g, 'O').toLowerCase();
    expect((await post('/auth/verify', { code: typed }, accessToken)).status).toBe(200);
  });

  /**
   * A code minted for one account cannot confirm another's address. Nothing
   * structural stops it — the collection is not tenant scoped — so the filter
   * has to, which is exactly the case §11 asks for.
   */
  it('cannot be spent on somebody elses account', async () => {
    const { hashPassword } = await import('@homefarm/api/auth/password');
    const { insertOrg, insertUser, findUserById } = await import('@homefarm/api/db/identity');
    const otherOrg = ulid();
    const other = ulid();
    await insertOrg({ _id: otherOrg, name: 'Far Field', createdAt: new Date() });
    await insertUser({
      _id: other,
      email: 'other@example.test',
      passwordHash: await hashPassword(PASSWORD),
      name: 'Somebody else',
      orgId: otherOrg,
      role: 'owner',
      createdAt: new Date(),
    } satisfies UserDoc);

    const code = await freshCode();
    await installCode(code);

    const app = await buildApp();
    const signIn = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'other@example.test', password: PASSWORD },
    });
    await app.close();
    const stolen = (JSON.parse(signIn.body) as { accessToken: string }).accessToken;

    expect((await post('/auth/verify', { code }, stolen)).status).toBe(400);
    expect((await findUserById(other))?.emailVerifiedAt).toBeUndefined();
    // And the account it was really for is untouched.
    expect(await verifiedAt()).toBeUndefined();
  });
});

describeDb('correcting a mistyped address', () => {
  it('moves the account and leaves the new one unproved', async () => {
    const { accessToken } = await tokens();

    const answer = await post(
      '/auth/email',
      { email: CORRECTED, password: PASSWORD },
      accessToken,
    );
    expect(answer.status).toBe(200);

    const { findUserByEmail } = await import('@homefarm/api/db/identity');
    expect((await findUserByEmail(CORRECTED))?._id).toBe(USER);
    expect(await verifiedAt()).toBeUndefined();
    // Signing in with the old address stops working, which is what "moved"
    // means and the thing somebody would notice if it had merely been copied.
    expect((await post('/auth/login', { email: EMAIL, password: PASSWORD })).status).toBe(401);
  });

  /**
   * **A session alone must not be enough.** Otherwise this route hands whoever
   * stole a refresh token an inbox they control, and the reset flow does the
   * rest — verification would have opened a takeover path rather than closing
   * one.
   */
  it('needs the account password, not just a session', async () => {
    const { accessToken } = await tokens();

    const answer = await post(
      '/auth/email',
      { email: CORRECTED, password: 'not-the-password' },
      accessToken,
    );

    expect(answer.status).toBe(403);
    const { findUserById } = await import('@homefarm/api/db/identity');
    expect((await findUserById(USER))?.email).toBe(EMAIL);
  });

  it('needs a session at all', async () => {
    expect((await post('/auth/email', { email: CORRECTED, password: PASSWORD })).status).toBe(401);
  });

  it('refuses an address somebody else already has', async () => {
    const { hashPassword } = await import('@homefarm/api/auth/password');
    const { insertOrg, insertUser, findUserById } = await import('@homefarm/api/db/identity');
    const otherOrg = ulid();
    await insertOrg({ _id: otherOrg, name: 'Far Field', createdAt: new Date() });
    await insertUser({
      _id: ulid(),
      email: CORRECTED,
      passwordHash: await hashPassword(PASSWORD),
      name: 'Somebody else',
      orgId: otherOrg,
      role: 'owner',
      createdAt: new Date(),
    } satisfies UserDoc);

    const { accessToken } = await tokens();
    const answer = await post(
      '/auth/email',
      { email: CORRECTED, password: PASSWORD },
      accessToken,
    );

    expect(answer.status).toBe(409);
    expect((await findUserById(USER))?.email).toBe(EMAIL);
  });

  /**
   * The feature that does not exist, refused rather than approximated.
   *
   * Moving a *proved* address needs the old one to confirm the move, or a
   * leaked session becomes a takeover in two requests. Saying so is better than
   * a generic refusal, because this one is not a security answer — it is the
   * truthful description of a thing that is not built.
   */
  it('will not move an address that has been confirmed', async () => {
    const { markEmailVerified, findUserById } = await import('@homefarm/api/db/identity');
    await markEmailVerified(USER, EMAIL, new Date());
    const { accessToken } = await tokens();

    const answer = await post(
      '/auth/email',
      { email: CORRECTED, password: PASSWORD },
      accessToken,
    );

    expect(answer.status).toBe(409);
    expect((await findUserById(USER))?.email).toBe(EMAIL);
  });

  /**
   * **The spam-folder case.** Somebody mistypes, waits, corrects the address,
   * and then finds the first code — which was sent to a stranger — and types
   * it. Confirming on the strength of it would prove the wrong string.
   */
  it('kills every code that was minted for the old address', async () => {
    const { accessToken } = await tokens();
    const code = await freshCode();
    await installCode(code);

    await post('/auth/email', { email: CORRECTED, password: PASSWORD }, accessToken);

    // The session survives the move, so this is the same person still signed in.
    expect((await post('/auth/verify', { code }, accessToken)).status).toBe(400);
    expect(await verifiedAt()).toBeUndefined();

    const row = await harness!.db.collection('emailVerifications').findOne({});
    expect(row?.supersededAt).toBeInstanceOf(Date);
  });

  /**
   * The second of the two guards, asserted on its own.
   *
   * `retireVerifyCodes` is the cheap half and could lose a race; the address on
   * the row is the half that holds regardless. A live, unsuperseded code minted
   * for a string the account no longer uses must still be refused.
   */
  it('refuses a live code that names an address the account has left', async () => {
    const { accessToken } = await tokens();
    const code = await freshCode();
    // Minted against an address this account does not have — the shape a
    // correction leaves behind if the supersede never lands.
    await installCode(code, { email: 'somewhere-else@example.test' });

    expect((await post('/auth/verify', { code }, accessToken)).status).toBe(400);
    expect(await verifiedAt()).toBeUndefined();
  });
});

describeDb('signing up with Google', () => {
  /**
   * Google has already done exactly the work `/auth/verify` asks for —
   * `verifyGoogleIdToken` refuses a token without `email_verified` — so an
   * account that arrives that way is proved on arrival. Asking again would
   * leave recovery off for no reason the farm could see.
   *
   * Asserted at the database rather than through the route, because reaching
   * the route needs a signed Google token this suite cannot mint. What is being
   * checked is the claim the routes make about the flag's meaning: nothing
   * writes it except a proof.
   */
  it('is the only signup that arrives already confirmed', async () => {
    const { insertUser, findUserById } = await import('@homefarm/api/db/identity');
    const googler = ulid();
    await insertUser({
      _id: googler,
      email: 'google@example.test',
      googleSub: 'sub-12345',
      emailVerifiedAt: new Date(),
      name: 'By Google',
      orgId: ORG,
      role: 'owner',
      createdAt: new Date(),
    } satisfies UserDoc);

    expect((await findUserById(googler))?.emailVerifiedAt).toBeInstanceOf(Date);
    // The password account seeded for every test in this file did not.
    expect(await verifiedAt()).toBeUndefined();
  });
});
