import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { UserDoc } from '@steading/api/db/identity';
import { startTestDb } from '../support/mongo';

/**
 * Rotating refresh tokens and family revocation (T7, rubric B2).
 *
 * Against a real mongod, because the interesting behaviour is all in the
 * conditional update: the reuse check has to be atomic or two concurrent
 * exchanges of one token both succeed, which is exactly the case theft looks
 * like.
 */

const harness = await startTestDb('steading_isolation');

if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'steading_isolation';
}

const SECRET = 'a-test-secret-long-enough-for-hs256-abcdef';

const OWNER = { _id: ulid(), orgId: ulid(), role: 'owner' as const };
const CLAIMS = { userId: OWNER._id, orgId: OWNER.orgId, role: OWNER.role };

const describeDb = harness ? describe : describe.skip;

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  if (!harness) return;
  await harness.db.collection('refreshTokens').deleteMany({});
  await harness.db.collection<UserDoc>('users').deleteMany({});
  await harness.db.collection<UserDoc>('users').insertOne({
    _id: OWNER._id,
    email: `${OWNER._id}@example.test`,
    passwordHash: 'unused-in-this-suite',
    name: 'Test User',
    orgId: OWNER.orgId,
    role: OWNER.role,
    createdAt: new Date(),
  });
});

describeDb('refresh token rotation', () => {
  it('issues a usable pair on sign-in', async () => {
    const { startSession } = await import('@steading/api/auth/refresh');
    const { verifyAccessToken } = await import('@steading/api/auth/tokens');

    const pair = await startSession(CLAIMS, SECRET);

    expect(await verifyAccessToken(pair.accessToken, SECRET)).toEqual(CLAIMS);
    expect(pair.refreshToken).toHaveLength(43); // 32 bytes, base64url
  });

  it('never stores the refresh token itself', async () => {
    const { startSession } = await import('@steading/api/auth/refresh');
    const pair = await startSession(CLAIMS, SECRET);

    const stored = await harness!.db.collection('refreshTokens').find({}).toArray();
    expect(stored).toHaveLength(1);
    // A database disclosure must not hand over usable tokens.
    expect(JSON.stringify(stored)).not.toContain(pair.refreshToken);
  });

  it('exchanges a token for a new pair', async () => {
    const { rotateSession, startSession } = await import('@steading/api/auth/refresh');

    const first = await startSession(CLAIMS, SECRET);
    const second = await rotateSession(first.refreshToken, SECRET);

    expect(second.refreshToken).not.toBe(first.refreshToken);
  });

  it('refuses the old token once it has been exchanged', async () => {
    const { rotateSession, startSession } = await import('@steading/api/auth/refresh');

    const first = await startSession(CLAIMS, SECRET);
    await rotateSession(first.refreshToken, SECRET);

    await expect(rotateSession(first.refreshToken, SECRET)).rejects.toThrow(/expired/i);
  });

  /**
   * The theft case, and the reason families exist.
   *
   * An honest client exchanges a token exactly once. A second presentation
   * means two parties hold it and there is no way to tell which is the thief,
   * so both are logged out: the user signs in again, the attacker's token is
   * worthless.
   */
  it('revokes the whole family when a used token is presented again', async () => {
    const { rotateSession, startSession } = await import('@steading/api/auth/refresh');

    const first = await startSession(CLAIMS, SECRET);
    const second = await rotateSession(first.refreshToken, SECRET);
    const third = await rotateSession(second.refreshToken, SECRET);

    // The attacker replays a token from earlier in the chain.
    await expect(rotateSession(first.refreshToken, SECRET)).rejects.toThrow(/expired/i);

    // And the legitimate client's current token is dead too — that is the point.
    await expect(rotateSession(third.refreshToken, SECRET)).rejects.toThrow(/expired/i);
  });

  it('cannot be exchanged twice concurrently', async () => {
    const { rotateSession, startSession } = await import('@steading/api/auth/refresh');

    const first = await startSession(CLAIMS, SECRET);

    // A read-then-write would let both of these through, minting two live
    // families from one token.
    const results = await Promise.allSettled([
      rotateSession(first.refreshToken, SECRET),
      rotateSession(first.refreshToken, SECRET),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('refuses an unknown token without disclosing anything', async () => {
    const { rotateSession } = await import('@steading/api/auth/refresh');
    await expect(rotateSession('not-a-real-token', SECRET)).rejects.toThrow(/expired/i);
  });

  it('refuses an expired token', async () => {
    const { rotateSession, startSession } = await import('@steading/api/auth/refresh');

    const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    const pair = await startSession(CLAIMS, SECRET, ninetyOneDaysAgo);

    await expect(rotateSession(pair.refreshToken, SECRET)).rejects.toThrow(/expired/i);
  });

  /**
   * A ninety-day token must not be a ninety-day snapshot of authority. The
   * refresh is the one moment a long-lived session can notice a role change.
   */
  it('re-derives role and org from the database on every exchange', async () => {
    const { rotateSession, startSession } = await import('@steading/api/auth/refresh');
    const { verifyAccessToken } = await import('@steading/api/auth/tokens');

    const first = await startSession(CLAIMS, SECRET);

    await harness!.db
      .collection<UserDoc>('users')
      .updateOne({ _id: OWNER._id }, { $set: { role: 'hand' } });

    const second = await rotateSession(first.refreshToken, SECRET);
    expect((await verifyAccessToken(second.accessToken, SECRET)).role).toBe('hand');
  });

  it('refuses to refresh a disabled account, and kills the family', async () => {
    const { rotateSession, startSession } = await import('@steading/api/auth/refresh');

    const first = await startSession(CLAIMS, SECRET);
    await harness!.db
      .collection<UserDoc>('users')
      .updateOne({ _id: OWNER._id }, { $set: { disabledAt: new Date() } });

    await expect(rotateSession(first.refreshToken, SECRET)).rejects.toThrow(/expired/i);
  });

  it('ends the whole family on sign-out', async () => {
    const { endSession, rotateSession, startSession } = await import('@steading/api/auth/refresh');

    const first = await startSession(CLAIMS, SECRET);
    const second = await rotateSession(first.refreshToken, SECRET);

    await endSession(second.refreshToken);

    await expect(rotateSession(second.refreshToken, SECRET)).rejects.toThrow(/expired/i);
  });

  it('is silent on signing out an unknown token', async () => {
    const { endSession } = await import('@steading/api/auth/refresh');
    // Sign-out must not become a way to probe which tokens exist.
    await expect(endSession('not-a-real-token')).resolves.toBeUndefined();
  });
});
