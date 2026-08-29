import { randomBytes } from 'node:crypto';
import { ulid } from 'ulid';
import {
  consumeRefreshToken,
  findRefreshToken,
  hashRefreshToken,
  insertRefreshToken,
  revokeFamily,
} from '../db/refresh-tokens';
import { findUserById } from '../db/identity';
import { HttpError } from '../http';
import type { SessionClaims } from './claims';
import { mintAccessToken } from './tokens';

/**
 * Rotating refresh tokens with family revocation (T7, rubric B2).
 *
 * Ninety days, because the product's claim is that a device can be away from
 * signal for weeks and still sync when it comes back. A refresh that expired
 * over a long offline stretch would strand exactly the user this app is for.
 */
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * How long a spent refresh token is still honoured — see `rotateSession`.
 *
 * Thirty seconds, which is Okta's default for the same problem. Long enough to
 * cover a killed process, a retried request and two triggers waking together;
 * short enough that a stolen token is useful for half a minute rather than for
 * ninety days.
 */
const REUSE_GRACE_MS = 30 * 1000;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds. The client refreshes ahead of this rather than on a 401. */
  accessExpiresAt: number;
}

/** 256 bits from the CSPRNG. Nothing about it is guessable or derivable. */
function mintRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

async function issue(
  claims: SessionClaims,
  familyId: string,
  secret: string,
  now: Date,
): Promise<TokenPair> {
  const refreshToken = mintRefreshToken();

  await insertRefreshToken({
    _id: hashRefreshToken(refreshToken),
    userId: claims.userId,
    familyId,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
  });

  const accessToken = await mintAccessToken(claims, secret, now);

  return {
    accessToken,
    refreshToken,
    accessExpiresAt: Math.floor(now.getTime() / 1000) + 15 * 60,
  };
}

/** A successful sign-in. Starts a new family. */
export async function startSession(
  claims: SessionClaims,
  secret: string,
  now = new Date(),
): Promise<TokenPair> {
  return issue(claims, ulid(), secret, now);
}

/**
 * Exchanges a refresh token for a new pair.
 *
 * The order of checks is the security-relevant part:
 *
 * 1. Unknown token → 401. Nothing is disclosed about whether it ever existed.
 * 2. Already revoked → 401. The family was killed; this is the tail of it.
 * 3. Expired → 401.
 * 4. **Already used → revoke the entire family, then 401.** This is the theft
 *    signal. A token is exchanged exactly once by an honest client, so a
 *    second presentation means two parties hold it, and there is no way to
 *    tell which one is the thief. Killing the family logs both out, which is
 *    the only safe answer: the legitimate user signs in again, and the
 *    attacker's stolen token is worthless.
 * 5. Otherwise consume it and issue the next pair in the same family.
 *
 * The consume is a conditional update rather than a read-then-write, so two
 * concurrent refreshes with the same token cannot both win. The loser is
 * treated as reuse — which, from the server's position, is exactly what it
 * cannot be distinguished from.
 */
/**
 * What a presented token's `usedAt` means, given the clock.
 *
 * Pulled out as a pure function so it can be tested without a database. The
 * suites that exercise `rotateSession` need a real mongod, and the machine this
 * was written on cannot reach one — so the arithmetic that decides whether a
 * farm keeps its session lives where an ordinary unit test can reach it, and
 * only the wiring depends on CI.
 *
 * `stolen` is a verdict about evidence, not about intent: it means a token
 * turned up again long enough after its exchange that no honest retry explains
 * it. What follows is family revocation, which is severe, so the boundary is
 * worth being able to assert on directly.
 */
export function reuseVerdict(
  usedAt: Date | undefined,
  now: Date,
): 'fresh' | 'within-grace' | 'stolen' {
  if (usedAt === undefined) return 'fresh';
  // Negative elapsed means a clock that went backwards — NTP stepping, a
  // container resuming. Treated as inside the window: a skewed clock must not
  // be able to sign a farm out.
  return now.getTime() - usedAt.getTime() > REUSE_GRACE_MS ? 'stolen' : 'within-grace';
}

export async function rotateSession(
  presented: string,
  secret: string,
  now = new Date(),
): Promise<TokenPair> {
  const lapsed = new HttpError(401, 'Your session has expired. Sign in again.');

  const existing = await findRefreshToken(hashRefreshToken(presented));
  if (!existing || existing.revokedAt) throw lapsed;

  if (existing.expiresAt <= now) throw lapsed;

  /**
   * A token presented twice, and the second time is not always theft.
   *
   * Rotation with reuse detection is the rule (RFC 9700) and it stays: a spent
   * token turning up means either an attacker has a copy or this app has one,
   * and the server cannot tell which — so it revokes the family and everybody
   * signs in again. That is correct against theft and brutal against the
   * ordinary case, which is far more common:
   *
   *  - the app is killed between the server rotating and the device writing
   *    the replacement, so the next launch presents a token already spent;
   *  - a request times out on a bad connection, the server having handled it,
   *    and the client retries with the same token;
   *  - two contexts wake together — `sync/triggers.ts` fires on resume AND on
   *    network regain, which on a handset is the same second.
   *
   * The client is single-flight and that closes the third. **Nothing on the
   * client can close the first two**, because they are about a response that
   * never arrived.
   *
   * So: a grace window, which is what the field settled on. Okta ships thirty
   * seconds by default for exactly this. Inside it, a spent token is treated
   * as this app retrying and a fresh token is issued into the same family;
   * outside it, the behaviour is unchanged and the family goes.
   *
   * The cost is stated plainly: an attacker who steals a token AND presents it
   * within `REUSE_GRACE_MS` of the legitimate use gets a working session. The
   * window is the whole of the exposure, it is bounded, and against it sits a
   * farm being asked for a password in a yard because a lorry went past a mast
   * at the wrong moment.
   */
  if (reuseVerdict(existing.usedAt, now) === 'stolen') {
    await revokeFamily(existing.familyId, now);
    throw lapsed;
  }

  if (existing.usedAt === undefined) {
    const outcome = await consumeRefreshToken(existing._id, now);

    /**
     * A failed consume used to mean one thing here and it meant two.
     *
     * `already-used` is the case this was written for: another exchange of the
     * same token won by microseconds, which is inside the grace by definition,
     * so no revocation and carry on.
     *
     * **`revoked` is not that.** `consumeRefreshToken`'s filter matches on
     * `revokedAt` as well as `usedAt`, so a password reset or a member removal
     * landing between the read above and this update produced the identical
     * failure — and reading it as the benign race meant issuing a fresh 90-day
     * token into a family that had just been revoked. The one moment a
     * revocation most needs to win is the one where a session is being renewed.
     *
     * The family is revoked again rather than merely refused, so the outcome
     * does not depend on which revoker ran: `revokeAllForUser` covers every
     * family of one user, `revokeFamily` covers one family of any user, and
     * this makes sure the family in hand is dead either way.
     */
    if (outcome === 'revoked') {
      await revokeFamily(existing.familyId, now);
      throw lapsed;
    }
  }

  /**
   * Re-derived from the database, never carried over from the old token. A
   * refresh is the one moment a long-lived session can notice that a role
   * changed or an account was disabled, and carrying the old claims forward
   * would make a 90-day token a 90-day snapshot of authority.
   */
  const user = await findUserById(existing.userId);
  if (!user || user.disabledAt) {
    await revokeFamily(existing.familyId, now);
    throw lapsed;
  }

  /**
   * One last look before minting, and it narrows rather than closes.
   *
   * Every check above reads state that can go stale before the token is issued
   * — the revocation test at the top of this function, and the `within-grace`
   * path, which reaches here having written nothing at all and so has no
   * atomic update to carry a guard for it. This shrinks that window from the
   * whole body of the function to the gap between this read and the insert.
   *
   * **Closing it entirely needs a transaction, and this service deliberately
   * does not require a replica set** — the same trade `identity.ts` states for
   * account creation: needing one to run the tests would make the setup harder
   * than the feature. Stated rather than papered over: a revocation landing
   * inside those microseconds still loses.
   *
   * Safe to read rather than re-check atomically because `revokedAt` never
   * clears; see `consumeRefreshToken`.
   */
  if ((await findRefreshToken(existing._id))?.revokedAt) throw lapsed;

  return issue(
    { userId: user._id, orgId: user.orgId, role: user.role },
    existing.familyId,
    secret,
    now,
  );
}

/**
 * Sign-out. Revokes the whole family rather than the presented token, so
 * signing out on one device cannot leave a rotated descendant alive.
 *
 * Silent on an unknown token: sign-out must not become a way to probe which
 * tokens exist, and there is nothing useful to tell a caller who is already
 * trying to end a session.
 */
export async function endSession(presented: string, now = new Date()): Promise<void> {
  const existing = await findRefreshToken(hashRefreshToken(presented));
  if (existing) await revokeFamily(existing.familyId, now);
}
