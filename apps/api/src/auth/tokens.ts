import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { ulid } from 'ulid';
import type { Role } from '@steading/contracts';
import {
  consumeRefreshToken,
  findRefreshToken,
  insertRefreshToken,
  revokeFamily,
} from '../db/sessions';
import { HttpError } from '../http';

/**
 * Short-lived access token, long-lived rotating refresh token.
 *
 * The split exists because of how this app is used: a phone in a barn is
 * offline for hours and then flushes a queue. A single long-lived credential
 * would make theft open-ended; a short one alone would mean a farmer who
 * comes back inside cannot sync without signing in again. Fifteen minutes of
 * access plus a rotating refresh is the compromise that keeps both properties.
 *
 * The access token's claims are a snapshot, and are never treated as
 * authorization on their own (invariant 8) — `resolvePrincipal` re-reads the
 * user document on every mutation.
 */

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_DAYS = 60;
const ISSUER = 'steading';
const AUDIENCE = 'steading-app';

let cachedSecret: Uint8Array | null = null;

/**
 * Fails at first use rather than falling back to a development default.
 *
 * A default secret is worse than no secret: it boots, it looks fine, and every
 * deployment that forgot to set the variable shares one signing key.
 */
function secret(): Uint8Array {
  if (cachedSecret) return cachedSecret;

  const raw = process.env.STEADING_JWT_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error(
      'STEADING_JWT_SECRET must be set to at least 32 characters. Generate one with `openssl rand -base64 48`.',
    );
  }

  cachedSecret = new TextEncoder().encode(raw);
  return cachedSecret;
}

export interface AccessClaims {
  userId: string;
  orgId: string;
  role: Role;
}

export interface TokenPair {
  accessToken: string;
  /** Seconds until the access token expires, for the client's refresh timer. */
  expiresIn: number;
  refreshToken: string;
}

export async function issueAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ orgId: claims.orgId, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(secret());
}

/**
 * Verifies signature, issuer, audience and expiry, and returns the subject.
 *
 * Only the subject. The org and role in the token are deliberately not
 * returned: every caller must go through `resolvePrincipal`, so there is no
 * path where a stale role in a token becomes an authorization decision.
 */
export async function verifyAccessToken(token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new HttpError(401, 'Sign in again.');
    }

    return payload.sub;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, 'Sign in again.');
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function mintRefreshToken(userId: string, familyId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();

  await insertRefreshToken({
    _id: hashToken(token),
    userId,
    familyId,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + REFRESH_TTL_DAYS * 86_400_000),
  });

  return token;
}

/** A fresh sign-in starts a new family. */
export async function issueTokenPair(claims: AccessClaims): Promise<TokenPair> {
  return {
    accessToken: await issueAccessToken(claims),
    expiresIn: ACCESS_TTL_SECONDS,
    refreshToken: await mintRefreshToken(claims.userId, ulid()),
  };
}

/**
 * Exchanges a refresh token for a new pair, rotating it.
 *
 * Presenting an already-rotated token revokes its entire family. The only ways
 * that happens are a stolen token being replayed or a client that lost track
 * of its own rotation, and both are better answered with a forced sign-in than
 * with a new session.
 *
 * The caller supplies `claims` from `resolvePrincipal`, so a user disabled or
 * demoted since sign-in cannot refresh their way past it.
 */
export async function rotateRefreshToken(
  presented: string,
  resolve: (userId: string) => Promise<AccessClaims>,
): Promise<TokenPair> {
  const hash = hashToken(presented);
  const stored = await findRefreshToken(hash);

  // Unknown token: nothing to revoke, and no signal about whether it ever
  // existed.
  if (!stored) throw new HttpError(401, 'Sign in again.');

  if (stored.revokedAt || stored.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(401, 'Sign in again.');
  }

  if (!(await consumeRefreshToken(hash))) {
    // Already used. Either theft or a confused client — revoke the lot.
    await revokeFamily(stored.familyId);
    throw new HttpError(401, 'Sign in again.');
  }

  const claims = await resolve(stored.userId);

  return {
    accessToken: await issueAccessToken(claims),
    expiresIn: ACCESS_TTL_SECONDS,
    refreshToken: await mintRefreshToken(stored.userId, stored.familyId),
  };
}

/** Test seam. Production reads the environment once and caches it. */
export function resetSecretCache(): void {
  cachedSecret = null;
}
