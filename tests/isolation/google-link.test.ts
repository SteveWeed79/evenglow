import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserDoc } from '@homefarm/api/db/identity';
import { startTestDb } from '../support/mongo';

/**
 * Binding a Google identity to an account that already exists (A2.4, H1).
 *
 * **The audit finding this suite exists for.** `/auth/google` used to find an
 * account by address and link the Google subject to it unconditionally. But
 * `/auth/signup` proves nothing — it sends no mail and sets no
 * `emailVerifiedAt` — so an address in the `users` collection is somebody's
 * claim, not a fact. Signing up as `victim@example.test` and waiting therefore
 * handed the victim's Google sign-in to the attacker's farm: the victim taps
 * the Google button, lands inside the attacker's org as the attacker's user,
 * and everything they log syncs there. One-way, too — `/auth/signup` 409s for
 * that address afterwards and nothing unbinds a `googleSub`.
 *
 * What is tested here is both halves of the guard: the filter inside
 * `linkGoogleSub`, and the route's behaviour on top of it — including that the
 * refusal is word-for-word the one a disabled account gets, because a distinct
 * message would answer "does that address have an account?".
 *
 * The Google verifier is stubbed at the module boundary: a real ID token needs
 * Google's signing keys, and what is under test is what this app decides after
 * the token has been believed. `tests/unit/google-auth.test.ts` covers the
 * believing.
 */

const stub = vi.hoisted(() => ({
  verify: vi.fn(),
}));

vi.mock('@homefarm/api/auth/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@homefarm/api/auth/google')>()),
  verifyGoogleIdToken: stub.verify,
}));

const harness = await startTestDb('homefarm_google_link');

if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'homefarm_google_link';
}

const SECRET = 'a-test-secret-long-enough-for-hs256-abcdef';
const PASSWORD = 'a properly long passphrase';

/** The one refusal every failing branch of `/auth/google` shares. */
const REFUSED = 'That Google sign-in did not work. Try again.';

const describeDb = harness ? describe : describe.skip;

async function server() {
  const { buildServer } = await import('@homefarm/api/server');
  const { readEnv } = await import('@homefarm/api/env');
  return buildServer(
    readEnv({
      AUTH_SECRET: SECRET,
      MONGODB_URI: harness!.uri,
      MONGODB_DB: 'homefarm_google_link',
      GOOGLE_CLIENT_IDS: '123-android.apps.googleusercontent.com',
    }),
  );
}

interface Seeded {
  userId: string;
  orgId: string;
  email: string;
}

/** An account exactly as `/auth/signup` leaves one: no proof of the address. */
async function seedAccount(
  overrides: Partial<UserDoc> = {},
): Promise<Seeded> {
  const { hashPassword } = await import('@homefarm/api/auth/password');
  const { insertOrg, insertUser } = await import('@homefarm/api/db/identity');

  const orgId = ulid();
  const userId = ulid();
  const email = `farmer-${userId}@example.test`.toLowerCase();

  await insertOrg({ _id: orgId, name: 'Hollow Farm', createdAt: new Date() });
  await insertUser({
    _id: userId,
    email,
    passwordHash: await hashPassword(PASSWORD),
    name: 'Hollow Farm',
    orgId,
    role: 'owner',
    createdAt: new Date(),
    ...overrides,
  });

  return { userId, orgId, email };
}

async function storedUser(userId: string): Promise<UserDoc> {
  const { findUserById } = await import('@homefarm/api/db/identity');
  const user = await findUserById(userId);
  if (user === null) throw new Error(`no user ${userId}`);
  return user;
}

/** Points the stubbed verifier at one address and subject. */
function tokenFor(email: string, googleSub: string, name = 'Sam'): void {
  stub.verify.mockResolvedValue({ googleSub, email, name });
}

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  stub.verify.mockReset();
  if (!harness) return;
  await harness.db.collection('refreshTokens').deleteMany({});
  await harness.db.collection<UserDoc>('users').deleteMany({});
  await harness.db.collection('orgs').deleteMany({});
  // The partial unique index on `googleSub` is the second line of defence
  // behind the filter, so these run with it in place rather than without.
  const { applyIndexes } = await import('@homefarm/api/db/indexes');
  await applyIndexes(harness.db);
});

describeDb('linkGoogleSub', () => {
  it('binds a proved account that no Google identity holds', async () => {
    const { linkGoogleSub } = await import('@homefarm/api/db/identity');
    const { userId } = await seedAccount({ emailVerifiedAt: new Date() });

    expect(await linkGoogleSub(userId, 'sub-first')).toBe(true);
    expect((await storedUser(userId)).googleSub).toBe('sub-first');
  });

  it('refuses an account whose address was never proved, and writes nothing', async () => {
    const { linkGoogleSub } = await import('@homefarm/api/db/identity');
    const { userId } = await seedAccount();

    expect(await linkGoogleSub(userId, 'sub-attacker')).toBe(false);
    expect((await storedUser(userId)).googleSub).toBeUndefined();
  });

  it('refuses to rebind an account another Google identity already holds', async () => {
    const { linkGoogleSub } = await import('@homefarm/api/db/identity');
    const { userId } = await seedAccount({
      emailVerifiedAt: new Date(),
      googleSub: 'sub-original',
    });

    expect(await linkGoogleSub(userId, 'sub-second')).toBe(false);
    expect((await storedUser(userId)).googleSub).toBe('sub-original');
  });

  /**
   * The reason the condition is in the filter rather than in an `if` above it:
   * two first-time sign-ins for one address, arriving together with different
   * subjects, are two readers that both see `googleSub` absent.
   */
  it('lets exactly one of two simultaneous links win', async () => {
    const { linkGoogleSub } = await import('@homefarm/api/db/identity');
    const { userId } = await seedAccount({ emailVerifiedAt: new Date() });

    const results = await Promise.all([
      linkGoogleSub(userId, 'sub-a'),
      linkGoogleSub(userId, 'sub-b'),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(['sub-a', 'sub-b']).toContain((await storedUser(userId)).googleSub);
  });
});

describeDb('POST /auth/google — linking onto an existing account', () => {
  it('signs in and links when the account has proved its address', async () => {
    const { userId, orgId, email } = await seedAccount({ emailVerifiedAt: new Date() });
    tokenFor(email, 'sub-genuine');

    const app = await server();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: 'anything', orgId: ulid(), orgName: 'Ignored' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeTypeOf('string');
    expect(body.user.id).toBe(userId);
    expect(body.org.name).toBe('Hollow Farm');
    expect((await storedUser(userId)).googleSub).toBe('sub-genuine');
    // The org the device offered to claim must not have been created: this was
    // a sign-in, and branch 3 is the only branch that claims anything.
    expect(await harness!.db.collection('orgs').countDocuments({})).toBe(1);
    expect((await storedUser(userId)).orgId).toBe(orgId);
    await app.close();
  });

  /**
   * H1 itself. The attacker has typed the victim's address into `/auth/signup`;
   * the victim now taps Sign in with Google.
   */
  it('refuses when the stored account never proved the address', async () => {
    const { userId, email } = await seedAccount();
    tokenFor(email, 'sub-victim');

    const app = await server();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: 'anything', orgId: ulid(), orgName: 'Ignored' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: REFUSED });
    // No session, and the attacker's row is untouched — no `googleSub`, and
    // still unproved, so a later `/auth/verify` is what would settle it.
    expect(res.json().accessToken).toBeUndefined();
    const after = await storedUser(userId);
    expect(after.googleSub).toBeUndefined();
    expect(after.emailVerifiedAt).toBeUndefined();
    expect(await harness!.db.collection('refreshTokens').countDocuments({})).toBe(0);
    await app.close();
  });

  it('refuses when another Google identity already holds the account', async () => {
    const { userId, email } = await seedAccount({
      emailVerifiedAt: new Date(),
      googleSub: 'sub-original',
    });
    tokenFor(email, 'sub-usurper');

    const app = await server();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: 'anything', orgId: ulid(), orgName: 'Ignored' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: REFUSED });
    expect((await storedUser(userId)).googleSub).toBe('sub-original');
    await app.close();
  });

  /**
   * Non-enumeration is the whole reason the message is a constant. An unproved
   * account, a disabled account and a Google account that does not work must
   * be indistinguishable from the outside, or the route answers the question a
   * sign-in screen must not be able to ask.
   */
  it('says exactly what a disabled account says', async () => {
    const unproved = await seedAccount();
    const disabled = await seedAccount({
      emailVerifiedAt: new Date(),
      disabledAt: new Date(),
    });

    tokenFor(unproved.email, 'sub-one');
    const appA = await server();
    const first = await appA.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: 'anything', orgId: ulid(), orgName: 'Ignored' },
    });
    await appA.close();

    tokenFor(disabled.email, 'sub-two');
    const appB = await server();
    const second = await appB.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: 'anything', orgId: ulid(), orgName: 'Ignored' },
    });
    await appB.close();

    expect(first.statusCode).toBe(second.statusCode);
    expect(first.json()).toEqual(second.json());
  });
});

/**
 * Connecting Google from inside a session — the way back from H1.
 *
 * The block above is the refusal: `/auth/google` will not bind a Google
 * identity to an account whose address was never proved, because an address in
 * `users` is a claim rather than a fact. Every password account is in exactly
 * that state, so that fix costs every one of them a code read out of an inbox
 * before the Google button will work — and for the mistyped address the whole
 * verification feature exists for, that inbox is somebody else's.
 *
 * This route is what makes the step unnecessary: whoever holds the session *is*
 * the account, which is a better proof than the address ever was, and a better
 * one than the sign-in route could have had.
 */

/** A real bearer for a seeded account, minted the way a handset gets one. */
async function bearerFor(email: string): Promise<string> {
  const app = await server();
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: PASSWORD },
  });
  await app.close();
  return (JSON.parse(res.body) as { accessToken: string }).accessToken;
}

async function postLink(
  payload: unknown,
  accessToken?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const app = await server();
  const res = await app.inject({
    method: 'POST',
    url: '/auth/google/link',
    payload: payload as never,
    ...(accessToken === undefined
      ? {}
      : { headers: { authorization: `Bearer ${accessToken}` } }),
  });
  await app.close();
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

describeDb('POST /auth/google/link', () => {
  it('connects an account whose address was never proved', async () => {
    const { userId, email } = await seedAccount();
    const bearer = await bearerFor(email);
    tokenFor('someone.else@gmail.test', 'sub-in-session');

    const res = await postLink({ idToken: 'anything', password: PASSWORD }, bearer);

    expect(res.status).toBe(200);
    expect((await storedUser(userId)).googleSub).toBe('sub-in-session');
    // The refusal the sign-in route would still give this account, gone.
    expect(res.body['account']).toMatchObject({ googleLinked: true });
  });

  /**
   * The one moment a wrong link can be noticed. An Android handset with two
   * Google accounts on it offers a chooser whose default is the top one, and
   * nothing else in the app ever names the subject that was bound.
   */
  it('says which Google account it connected', async () => {
    const { email } = await seedAccount();
    const bearer = await bearerFor(email);
    tokenFor('the.other.one@gmail.test', 'sub-echo');

    const res = await postLink({ idToken: 'anything', password: PASSWORD }, bearer);

    expect(res.body['linked']).toEqual({ email: 'the.other.one@gmail.test' });
  });

  it('refuses without a session at all', async () => {
    const { userId, email } = await seedAccount();
    void email;
    tokenFor('nobody@gmail.test', 'sub-unauthenticated');

    const res = await postLink({ idToken: 'anything', password: PASSWORD });

    expect(res.status).toBe(401);
    expect((await storedUser(userId)).googleSub).toBeUndefined();
  });

  it('refuses a wrong password and writes nothing', async () => {
    const { userId, email } = await seedAccount();
    const bearer = await bearerFor(email);
    tokenFor('someone.else@gmail.test', 'sub-wrong-password');

    const res = await postLink({ idToken: 'anything', password: 'not the passphrase' }, bearer);

    expect(res.status).toBe(403);
    expect((await storedUser(userId)).googleSub).toBeUndefined();
  });

  /**
   * Ordering, and it is a security property rather than a tidiness one.
   *
   * With the password checked first, a caller holding only a stolen session
   * would get unlimited password guesses against this route without presenting
   * a Google credential of any kind — bounded by a limiter keyed on an IP
   * address. Verifying the token first costs an attacker a real Google account
   * per attempt.
   */
  it('refuses a bad Google token before it looks at the password', async () => {
    const { email } = await seedAccount();
    const bearer = await bearerFor(email);
    stub.verify.mockRejectedValue(
      new (await import('@homefarm/api/http')).HttpError(401, REFUSED),
    );

    const res = await postLink({ idToken: 'rubbish', password: 'not the passphrase' }, bearer);

    // The Google answer, not the password one — so nothing was learned about
    // the password by a caller who never had a Google account.
    expect(res.status).toBe(401);
    expect(res.body['error']).toBe(REFUSED);
  });

  it('refuses to rebind an account that already has a Google identity', async () => {
    const { userId, email } = await seedAccount({ googleSub: 'sub-original' });
    const bearer = await bearerFor(email);
    tokenFor('another@gmail.test', 'sub-second');

    const res = await postLink({ idToken: 'anything', password: PASSWORD }, bearer);

    expect(res.status).toBe(409);
    expect((await storedUser(userId)).googleSub).toBe('sub-original');
  });

  /**
   * The account Google made. It has no password to prove and needs none — it
   * already carries the identity this route would bind — so the truthful answer
   * is about the link, never about a password it never had. `/auth/email` calls
   * this case unreachable and warns that "unreachable" stops being true when
   * somebody adds a route; this is that route.
   */
  it('tells a Google-created account the truth rather than that its password is wrong', async () => {
    const { userId, orgId, email } = await seedAccount({
      googleSub: 'sub-made-by-google',
      emailVerifiedAt: new Date(),
    });
    // What `/auth/google` branch 3 writes: no `passwordHash` at all, because
    // nothing was ever set and so nothing can be guessed.
    await harness!.db
      .collection<UserDoc>('users')
      .updateOne({ _id: userId }, { $unset: { passwordHash: '' } });

    // No password to sign in with, so the bearer is minted rather than earned.
    const { mintAccessToken } = await import('@homefarm/api/auth/tokens');
    const bearer = await mintAccessToken({ userId, orgId, role: 'owner' }, SECRET);
    tokenFor(email, 'sub-something-new');

    const res = await postLink({ idToken: 'anything' }, bearer);

    expect(res.status).toBe(409);
    expect(res.body['error']).not.toBe('That password is not right.');
  });

  /**
   * The cross-account case, and the only shape tenancy can take here.
   *
   * CLAUDE.md's literal isolation test — org A's token against org B's
   * document id — has no form on this route: it acts on `claims.userId` and
   * takes no id from the payload, so acting on another farm's row is not
   * refused, it is impossible to ask for. What can cross is a Google subject,
   * because `googleSub` is unique across the whole collection rather than per
   * farm. That is what this asserts.
   */
  it('refuses a Google account another farm already holds, and leaves it alone', async () => {
    const theirs = await seedAccount({ googleSub: 'sub-taken', emailVerifiedAt: new Date() });
    const mine = await seedAccount();
    const bearer = await bearerFor(mine.email);
    tokenFor('shared@gmail.test', 'sub-taken');

    const res = await postLink({ idToken: 'anything', password: PASSWORD }, bearer);

    expect(res.status).toBe(409);
    expect((await storedUser(mine.userId)).googleSub).toBeUndefined();
    // The farm that holds it keeps it.
    expect((await storedUser(theirs.userId)).googleSub).toBe('sub-taken');
  });

  /**
   * Google has proved the address, so `/auth/verify` would be asking twice —
   * but only when it is the same address.
   */
  it('confirms the account’s email when the Google address is the same one', async () => {
    const { userId, email } = await seedAccount();
    const bearer = await bearerFor(email);
    tokenFor(email.toUpperCase(), 'sub-same-address');

    await postLink({ idToken: 'anything', password: PASSWORD }, bearer);

    expect((await storedUser(userId)).emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('leaves the account’s email unproved when the Google address is a different one', async () => {
    const { userId, email } = await seedAccount();
    const bearer = await bearerFor(email);
    tokenFor('personal@gmail.test', 'sub-other-address');

    await postLink({ idToken: 'anything', password: PASSWORD }, bearer);

    const after = await storedUser(userId);
    expect(after.googleSub).toBe('sub-other-address');
    // Connecting a personal Google account under another address is ordinary
    // and allowed. What it must not do is claim this address was proved.
    expect(after.emailVerifiedAt).toBeUndefined();
    expect(after.email).toBe(email);
  });
});

describeDb('linkGoogleSubInSession', () => {
  it('binds an account whose address was never proved', async () => {
    const { linkGoogleSubInSession } = await import('@homefarm/api/db/identity');
    const { userId } = await seedAccount();

    expect(await linkGoogleSubInSession(userId, 'sub-unproved')).toBe(true);
    expect((await storedUser(userId)).googleSub).toBe('sub-unproved');
  });

  it('refuses an account that has been removed from the farm', async () => {
    const { linkGoogleSubInSession } = await import('@homefarm/api/db/identity');
    const { userId } = await seedAccount({ disabledAt: new Date() });

    expect(await linkGoogleSubInSession(userId, 'sub-removed')).toBe(false);
    expect((await storedUser(userId)).googleSub).toBeUndefined();
  });

  it('lets exactly one of two simultaneous links win', async () => {
    const { linkGoogleSubInSession } = await import('@homefarm/api/db/identity');
    const { userId } = await seedAccount();

    const results = await Promise.all([
      linkGoogleSubInSession(userId, 'sub-a'),
      linkGoogleSubInSession(userId, 'sub-b'),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(['sub-a', 'sub-b']).toContain((await storedUser(userId)).googleSub);
  });
});
