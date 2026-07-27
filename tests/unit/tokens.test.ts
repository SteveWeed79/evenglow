import { describe, expect, it } from 'vitest';
import { bearerFrom, mintAccessToken, verifyAccessToken } from '@steading/api/auth/tokens';
import { readEnv } from '@steading/api/env';

/**
 * Access tokens. No database here — signing and verification are pure, and
 * keeping them testable without a mongod is why they are their own module.
 */

const SECRET = 'a-test-secret-long-enough-for-hs256-abcdef';
const CLAIMS = { userId: '01JABCDEFGHJKMNPQRSTVWXYZ', orgId: '01JZYXWVUTSRQPNMKJHGFEDCBA', role: 'owner' as const };

describe('access tokens', () => {
  it('round-trips the claims the server derived', async () => {
    const token = await mintAccessToken(CLAIMS, SECRET);
    expect(await verifyAccessToken(token, SECRET)).toEqual(CLAIMS);
  });

  it('refuses a token signed with a different secret', async () => {
    const token = await mintAccessToken(CLAIMS, SECRET);
    await expect(verifyAccessToken(token, `${SECRET}-other`)).rejects.toThrow(/expired/i);
  });

  it('refuses a tampered token', async () => {
    const token = await mintAccessToken(CLAIMS, SECRET);
    const [header, , signature] = token.split('.');
    // Flip the payload, keep the signature. This is the whole reason the
    // signature exists, so it is worth asserting rather than assuming.
    const forged = `${header}.${Buffer.from(
      JSON.stringify({ sub: 'someone-else', orgId: 'another-org', role: 'owner' }),
    ).toString('base64url')}.${signature}`;

    await expect(verifyAccessToken(forged, SECRET)).rejects.toThrow(/expired/i);
  });

  it('refuses an expired token', async () => {
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const token = await mintAccessToken(CLAIMS, SECRET, anHourAgo);

    await expect(verifyAccessToken(token, SECRET)).rejects.toThrow(/expired/i);
  });

  it('accepts a token minted moments ago', async () => {
    const token = await mintAccessToken(CLAIMS, SECRET, new Date(Date.now() - 5_000));
    expect((await verifyAccessToken(token, SECRET)).userId).toBe(CLAIMS.userId);
  });

  /**
   * A valid signature proves we issued it, not that it carries what this build
   * expects. A role this version does not know must be a 401, never an
   * `as Role` flowing into an authorization decision (invariant 11).
   */
  it('refuses a validly signed token carrying an unknown role', async () => {
    const token = await mintAccessToken(
      { ...CLAIMS, role: 'superuser' as unknown as typeof CLAIMS.role },
      SECRET,
    );
    await expect(verifyAccessToken(token, SECRET)).rejects.toThrow(/expired/i);
  });

  it('gives one answer for every failure', async () => {
    // Expired, wrong secret, and malformed must be indistinguishable, or the
    // response tells an attacker which part of the token to work on.
    const expired = await mintAccessToken(CLAIMS, SECRET, new Date(Date.now() - 60 * 60 * 1000));
    const messages = await Promise.all(
      [expired, 'not-a-token', await mintAccessToken(CLAIMS, `${SECRET}x`)].map((t) =>
        verifyAccessToken(t, SECRET).then(
          () => 'accepted',
          (e: Error) => e.message,
        ),
      ),
    );

    expect(new Set(messages).size).toBe(1);
  });
});

describe('bearer parsing', () => {
  it.each([
    ['Bearer abc.def.ghi', 'abc.def.ghi'],
    ['bearer abc.def.ghi', 'abc.def.ghi'],
  ])('accepts %s', (header, expected) => {
    expect(bearerFrom(header)).toBe(expected);
  });

  it.each([undefined, '', 'abc.def.ghi', 'Basic abc', 'Bearer'])(
    'rejects %s rather than guessing',
    (header) => {
      expect(bearerFrom(header)).toBeNull();
    },
  );
});

describe('server configuration', () => {
  const base = { AUTH_SECRET: SECRET, MONGODB_URI: 'mongodb://localhost:27017' };

  it('fails loudly on a short signing secret', () => {
    // A short HS256 key is weaker than the algorithm implies, and it is the
    // most common way JWT signing gets quietly downgraded.
    expect(() => readEnv({ ...base, AUTH_SECRET: 'too-short' })).toThrow(
      /AUTH_SECRET/,
    );
  });

  it('fails loudly rather than signing with undefined', () => {
    expect(() => readEnv({ MONGODB_URI: base.MONGODB_URI })).toThrow(
      /AUTH_SECRET/,
    );
  });

  it('splits CORS origins and never defaults to a wildcard', () => {
    const env = readEnv({
      ...base,
      CORS_ORIGINS: 'https://a.test, https://b.test',
    });

    expect(env.corsOrigins).toEqual(['https://a.test', 'https://b.test']);
    expect(env.corsOrigins).not.toContain('*');
  });
});
