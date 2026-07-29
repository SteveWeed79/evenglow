import { describe, expect, it } from 'vitest';
import { mintAccessToken, verifyAccessToken } from '@steading/api/auth/tokens';
import { decodeBase64Url, readClaims } from '@steading/mobile/auth/session';

/**
 * The server mints it. The client reads it. Nothing checked they agreed.
 *
 * `mintAccessToken` puts the user id in the standard `sub` claim via
 * `.setSubject()`. The client's schema required a `userId` field. No token has
 * ever carried one, so `readClaims` returned null for every token the server
 * has ever issued, and sign-in — with a correct email and password, against a
 * server that had just authenticated them — failed with "The server sent a
 * session we could not read."
 *
 * It survived a full auth suite on both sides because each side was tested
 * against itself: the server round-tripped its own tokens, and the client's
 * tests built claim objects by hand rather than parsing a real one. The only
 * arrangement that could catch it is this one — the real signer on one side of
 * the assertion and the real reader on the other.
 */

const SECRET = 'a'.repeat(48);
const CLAIMS = {
  userId: '01J8XQK5T7WZ3P4N6M8R2V9C0D',
  orgId: '01J8XQK5T7WZ3P4N6M8R2V9C0E',
  role: 'owner' as const,
};

describe('a token the server actually issues', () => {
  it('is readable by the client, field for field', async () => {
    const token = await mintAccessToken(CLAIMS, SECRET);

    expect(readClaims(token)).toEqual(CLAIMS);
  });

  it('carries the user id in sub, which is what both sides must agree on', async () => {
    const token = await mintAccessToken(CLAIMS, SECRET);
    const payload = JSON.parse(decodeBase64Url(token.split('.')[1]!));

    // Stated explicitly so a later change to either side has to change a test
    // that says why, rather than one that merely goes red.
    expect(payload.sub).toBe(CLAIMS.userId);
    expect(payload.userId).toBeUndefined();
  });

  it('reads the same claims the server itself derives', async () => {
    const token = await mintAccessToken(CLAIMS, SECRET);

    // The two readers must not disagree about who this is. If they ever do,
    // local UX would draw controls for one identity while the server enforced
    // another (invariant 8).
    expect(readClaims(token)).toEqual(await verifyAccessToken(token, SECRET));
  });

  it('works for every role', async () => {
    for (const role of ['owner', 'admin', 'hand'] as const) {
      const token = await mintAccessToken({ ...CLAIMS, role }, SECRET);
      expect(readClaims(token)?.role, role).toBe(role);
    }
  });
});

describe('what the client refuses', () => {
  it('refuses a token that is not a token', () => {
    expect(readClaims('')).toBeNull();
    expect(readClaims('nope')).toBeNull();
    expect(readClaims('a.b')).toBeNull();
  });

  it('refuses a payload missing a claim it needs', () => {
    const encode = (value: object) =>
      `x.${Buffer.from(JSON.stringify(value)).toString('base64url')}.y`;

    expect(readClaims(encode({ sub: 'u', orgId: 'o' }))).toBeNull();
    expect(readClaims(encode({ sub: 'u', role: 'owner' }))).toBeNull();
    expect(readClaims(encode({ orgId: 'o', role: 'owner' }))).toBeNull();
  });

  it('refuses a role that is not one of ours', () => {
    // A role string this build does not know must never reach an authorization
    // decision as an `as Role` (invariant 11).
    const payload = Buffer.from(
      JSON.stringify({ sub: 'u', orgId: 'o', role: 'superuser' }),
    ).toString('base64url');

    expect(readClaims(`x.${payload}.y`)).toBeNull();
  });
});

describe('the decoder, which no longer depends on a global', () => {
  it('decodes without padding, as JWT sends it', () => {
    // Lengths 1-3 mod 4 — the cases a padding-strict decoder rejects.
    for (const value of ['a', 'ab', 'abc', 'abcd', 'hello world']) {
      const encoded = Buffer.from(value).toString('base64url');
      expect(decodeBase64Url(encoded), value).toBe(value);
    }
  });

  it('decodes the URL-safe alphabet', () => {
    // Bytes chosen to produce '-' and '_' in base64url, which plain base64
    // would write as '+' and '/'.
    const bytes = Buffer.from([0xfb, 0xef, 0xbe]);
    const encoded = bytes.toString('base64url');

    expect(encoded).toMatch(/[-_]/);
    expect(decodeBase64Url(encoded)).toBe(bytes.toString('latin1'));
  });

  it('agrees with the platform decoder on real token payloads', async () => {
    const token = await mintAccessToken(CLAIMS, SECRET);
    const payload = token.split('.')[1]!;

    expect(decodeBase64Url(payload)).toBe(
      Buffer.from(payload, 'base64url').toString('latin1'),
    );
  });

  it('throws on something that is not base64 at all', () => {
    expect(() => decodeBase64Url('!!!!')).toThrow();
  });
});
