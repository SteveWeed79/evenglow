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
