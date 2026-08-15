import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDb } from '../support/mongo';

/**
 * The sign-in path, which had never executed.
 *
 * Every other suite mints a session directly, which is convenient and hid the
 * fact that nothing exercised the credentials provider, argon2, or the JWT
 * claims. argon2 is a native module and the unique email index had never been
 * created, so this is the code most likely to fail on first contact with a
 * real user — and it is the one path nobody can avoid.
 */

const harness = await startTestDb('steading_sign_in');

if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'steading_sign_in';
  process.env.AUTH_SECRET ??= 'sign-in-suite-secret-value-not-used-elsewhere';
}

const describeDb = harness ? describe : describe.skip;

const PASSWORD = 'a properly long passphrase';

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  if (!harness) return;
  await harness.db.collection('users').deleteMany({});
  await harness.db.collection('orgs').deleteMany({});
});

/** Creates an org and owner exactly as `pnpm db:seed` does. */
async function seedOwner(email: string): Promise<{ userId: string; orgId: string }> {
  const { hashPassword } = await import('@steading/api/auth/password');
  const { insertOrg, insertUser } = await import('@steading/api/db/identity');

  const orgId = ulid();
  const userId = ulid();

  await insertOrg({ _id: orgId, name: 'Hollow Farm', createdAt: new Date() });
  await insertUser({
    _id: userId,
    email,
    passwordHash: await hashPassword(PASSWORD),
    name: 'Hollow Farm',
    orgId,
    role: 'owner',
    createdAt: new Date(),
  });

  return { userId, orgId };
}

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    // argon2 is a native module — this is the first time it runs at all.
    const { hashPassword, verifyPassword } = await import('@steading/api/auth/password');

    const digest = await hashPassword(PASSWORD);
    expect(digest).not.toContain(PASSWORD);
    expect(await verifyPassword(digest, PASSWORD)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const { hashPassword, verifyPassword } = await import('@steading/api/auth/password');
    const digest = await hashPassword(PASSWORD);

    expect(await verifyPassword(digest, 'not the passphrase')).toBe(false);
  });

  it('treats a malformed stored digest as a wrong password, not a crash', async () => {
    const { verifyPassword } = await import('@steading/api/auth/password');
    expect(await verifyPassword('not-a-hash', PASSWORD)).toBe(false);
  });

  it('produces a different digest each time', async () => {
    const { hashPassword } = await import('@steading/api/auth/password');
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);

    // Salted, so two users with the same password are not obviously the same.
    expect(a).not.toBe(b);
  });
});

describeDb('identity storage', () => {
  it('round-trips a seeded owner', async () => {
    const { findUserByEmail } = await import('@steading/api/db/identity');
    const { userId, orgId } = await seedOwner('owner@example.test');

    const found = await findUserByEmail('owner@example.test');
    expect(found?._id).toBe(userId);
    expect(found?.orgId).toBe(orgId);
    expect(found?.role).toBe('owner');
  });

  it('finds a user regardless of how the email was typed', async () => {
    const { findUserByEmail } = await import('@steading/api/db/identity');
    await seedOwner('Owner@Example.Test');

    // A farmer typing their email with a capital at 6am still signs in.
    expect(await findUserByEmail('owner@example.test')).not.toBeNull();
    expect(await findUserByEmail('  OWNER@EXAMPLE.TEST  ')).not.toBeNull();
  });

  it('refuses a second account on the same email', async () => {
    const { applyIndexes } = await import('@steading/api/db/indexes');
    await applyIndexes(harness!.db);

    await seedOwner('owner@example.test');

    // The unique index is what makes the seed script's existence check
    // race-safe, and it had never actually been created before now.
    await expect(seedOwner('owner@example.test')).rejects.toThrow();
  });
});

describeDb('the credentials provider', () => {
  /** The real function the provider is configured with. */
  async function authorize(credentials: Record<string, unknown>) {
    const { authorizeCredentials } = await import('@steading/api/auth/credentials');
    return authorizeCredentials(credentials);
  }

  it('issues claims carrying orgId and role', async () => {
    const { userId, orgId } = await seedOwner('owner@example.test');

    const user = await authorize({ email: 'owner@example.test', password: PASSWORD });

    // Phase 1 Definition of Done: sign-in issues a JWT carrying orgId and role.
    expect(user?.id).toBe(userId);
    expect(user?.orgId).toBe(orgId);
    expect(user?.role).toBe('owner');
  });

  it('reads orgId from the user record, never from the input', async () => {
    const { orgId } = await seedOwner('owner@example.test');

    const user = await authorize({
      email: 'owner@example.test',
      password: PASSWORD,
      orgId: ulid(),
      role: 'owner',
    });

    expect(user?.orgId).toBe(orgId);
  });

  it('returns null for a wrong password', async () => {
    await seedOwner('owner@example.test');
    expect(await authorize({ email: 'owner@example.test', password: 'wrong' })).toBeNull();
  });

  it('returns null for an unknown email, exactly as for a wrong password', async () => {
    // Identical outcomes, so the response cannot be used to enumerate users.
    expect(await authorize({ email: 'nobody@example.test', password: PASSWORD })).toBeNull();
  });

  it('returns null for a disabled account', async () => {
    await seedOwner('owner@example.test');
    await harness!.db
      .collection('users')
      .updateOne({ email: 'owner@example.test' }, { $set: { disabledAt: new Date() } });

    expect(await authorize({ email: 'owner@example.test', password: PASSWORD })).toBeNull();
  });

  it('returns null for malformed input rather than throwing', async () => {
    expect(await authorize({})).toBeNull();
    expect(await authorize({ email: 'not an email', password: PASSWORD })).toBeNull();
    expect(await authorize({ email: 'owner@example.test' })).toBeNull();
  });
});
