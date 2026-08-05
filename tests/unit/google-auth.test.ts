import { describe, expect, it, vi } from 'vitest';
import { verifyGoogleIdToken } from '@steading/api/auth/google';
import { readEnv } from '@steading/api/env';

/**
 * Verifying a Google ID token (A2.4).
 *
 * **The audience check is the one that carries the weight**, and it is the one
 * that is easy to leave out: a valid Google ID token issued to somebody else's
 * application is still a perfectly valid, correctly signed Google ID token. A
 * server that checked only the signature would sign that person in as the
 * owner of a farm.
 *
 * The signature check itself is `jose`'s and is not re-tested here — what is
 * tested is everything this app decides on top of it, with the verifier handed
 * in so the claims can be controlled. That is the same seam the NWS alert
 * parser is tested through.
 */

const AUDIENCES = ['123-android.apps.googleusercontent.com'];

/** A stand-in for `jwtVerify` that returns whatever payload a test wants. */
const verifierReturning = (payload: unknown) =>
  vi.fn(async () => ({ payload }) as never);

const GOOD = {
  sub: '10769150350006150715113082367',
  email: 'sam@example.test',
  email_verified: true,
  name: 'Sam',
};

describe('verifying a Google identity', () => {
  it('takes the subject as the identity and the email as the label', async () => {
    const identity = await verifyGoogleIdToken('token', AUDIENCES, verifierReturning(GOOD));

    /**
     * `sub`, not the email. Google's subject survives somebody changing the
     * address on their account; matching on email alone would mean an account
     * silently changing hands the day an address is recycled.
     */
    expect(identity.googleSub).toBe(GOOD.sub);
    expect(identity.email).toBe('sam@example.test');
    expect(identity.name).toBe('Sam');
  });

  it('passes the configured audiences to the verifier', async () => {
    let options: { audience?: unknown; issuer?: unknown } = {};

    const verify = vi.fn(async (_token: unknown, _keys: unknown, given: unknown) => {
      options = given as { audience?: unknown; issuer?: unknown };
      return { payload: GOOD } as never;
    });

    await verifyGoogleIdToken('token', AUDIENCES, verify as never);

    expect(options.audience).toEqual(AUDIENCES);
    // Both issuer spellings, because Google has used each for years and which
    // one arrives is not something this app controls.
    expect(options.issuer).toContain('https://accounts.google.com');
    expect(options.issuer).toContain('accounts.google.com');
  });

  /**
   * An unverified address is not proof of anything.
   *
   * Google will issue a token carrying an address it has not confirmed on some
   * account types. Treating one as proof would let somebody sign in as whoever
   * really owns that address — and the account-linking path in `/auth/google`
   * binds a Google identity to an existing account **by email**, so this is
   * the check standing between a stranger and somebody else's farm.
   */
  it('refuses an unverified email', async () => {
    await expect(
      verifyGoogleIdToken('token', AUDIENCES, verifierReturning({ ...GOOD, email_verified: false })),
    ).rejects.toThrow(/did not work/);

    await expect(
      verifyGoogleIdToken('token', AUDIENCES, verifierReturning({ sub: GOOD.sub, email: GOOD.email })),
    ).rejects.toThrow(/did not work/);
  });

  it('refuses a payload missing anything it needs', async () => {
    await expect(
      verifyGoogleIdToken('token', AUDIENCES, verifierReturning({ email_verified: true })),
    ).rejects.toThrow(/did not work/);

    await expect(
      verifyGoogleIdToken('token', AUDIENCES, verifierReturning({ ...GOOD, email: 'not-an-email' })),
    ).rejects.toThrow(/did not work/);
  });

  /**
   * One answer for every credential failure, like `verifyAccessToken`. An
   * expired token, a token for another app and a forgery are all the same
   * sentence — distinguishing them tells an attacker which part to work on.
   */
  it('says the same thing whatever the verifier objected to', async () => {
    const boom = vi.fn(async () => {
      throw new Error('JWSSignatureVerificationFailed');
    });

    await expect(verifyGoogleIdToken('token', AUDIENCES, boom as never)).rejects.toThrow(
      /That Google sign-in did not work/,
    );
  });

  /**
   * Configuration, not a credential, so it does not get the generic answer.
   * A farm seeing this has hit a server that was never set up for Google
   * rather than a Google account that does not work.
   */
  it('refuses to verify anything when no client id is configured', async () => {
    const verify = verifierReturning(GOOD);
    await expect(verifyGoogleIdToken('token', [], verify)).rejects.toThrow(/not set up for Google/);

    // And it never reached the verifier, so an empty audience list cannot
    // become an accept-anything list.
    expect(verify).not.toHaveBeenCalled();
  });
});

describe('reading the client ids', () => {
  const base = {
    AUTH_SECRET: 'a-test-secret-long-enough-for-hs256-abcdef',
    MONGODB_URI: 'mongodb://localhost:27017',
  };

  it('splits and trims a comma-separated list', () => {
    const env = readEnv({
      ...base,
      GOOGLE_CLIENT_IDS: ' 123-android.apps.googleusercontent.com , 456-web.apps.googleusercontent.com ',
    });

    expect(env.googleClientIds).toEqual([
      '123-android.apps.googleusercontent.com',
      '456-web.apps.googleusercontent.com',
    ]);
  });

  /**
   * A server with no Google project is a supported state, not a broken one.
   * Email and password keep working and the route answers 501.
   */
  it('treats unset and empty alike, and does not fail startup', () => {
    expect(readEnv(base).googleClientIds).toEqual([]);
    expect(readEnv({ ...base, GOOGLE_CLIENT_IDS: '' }).googleClientIds).toEqual([]);
    expect(readEnv({ ...base, GOOGLE_CLIENT_IDS: ' , ' }).googleClientIds).toEqual([]);
  });
});
