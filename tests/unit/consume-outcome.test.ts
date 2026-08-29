import { describe, expect, it } from 'vitest';
import { consumeOutcome } from '@homefarm/api/db/refresh-tokens';

/**
 * Why a refresh token could not be consumed — which used to be one answer for
 * two different events.
 *
 * `consumeRefreshToken` marks a token exchanged with a filter requiring both
 * `usedAt` and `revokedAt` to be absent, and returned a bare boolean.
 * `rotateSession` read `false` as *"another exchange of this same token won by
 * microseconds"* — the benign concurrent case the reuse grace window exists for
 * — and carried on.
 *
 * But the filter matches on `revokedAt` too. **A password reset or a member
 * removal landing between the token being read and this update produced the
 * identical `false`**, and the caller went on to issue a fresh 90-day token
 * into a family that had just been revoked. The one moment a revocation most
 * needs to win is the one where a session is being renewed.
 *
 * ## Why this is a unit test and not part of the isolation suite
 *
 * The same reason `reuse-grace.test.ts` gives: `rotateSession` needs a real
 * mongod, CI has one and this machine cannot get one —
 * `fastdl.mongodb.org` is blocked by network policy, so `mongodb-memory-server`
 * has no binary to download. Letting CI be the first thing that runs a change
 * to session handling is how a previous round failed.
 *
 * So the rule lives in a pure function. The wiring is asserted in
 * `tests/isolation/refresh.test.ts` and depends on CI; the rule does not.
 *
 * ## Why reading the row afterwards is sound
 *
 * `revokedAt` is monotonic — `revokeFamily` and `revokeAllForUser` only ever
 * `$set` it and nothing in this service clears it — so a row that reads revoked
 * is revoked, whatever order the two writes landed in.
 */

const AT = new Date('2026-08-29T04:00:00.000Z');

describe('a consume that succeeded', () => {
  it('is consumed, whatever else the row says', () => {
    expect(consumeOutcome(true, undefined)).toBe('consumed');
    // Cannot happen — the filter excludes it — but the match is the authority.
    expect(consumeOutcome(true, AT)).toBe('consumed');
  });
});

describe('a consume that did not happen', () => {
  /** The case the grace window was written for: no revocation, carry on. */
  it('is a lost race when the row is not revoked', () => {
    expect(consumeOutcome(false, undefined)).toBe('already-used');
  });

  /**
   * The finding. This answered `already-used` and a revoked family was handed
   * a fresh ninety days.
   */
  it('is a revocation when the row is revoked', () => {
    expect(consumeOutcome(false, AT)).toBe('revoked');
  });

  /**
   * **The three are distinguishable at all**, which is the shape of the fix
   * rather than any one of its branches. A boolean could not say this.
   */
  it('gives three different answers to three different states', () => {
    const answers = new Set([
      consumeOutcome(true, undefined),
      consumeOutcome(false, undefined),
      consumeOutcome(false, AT),
    ]);

    expect(answers.size).toBe(3);
  });
});
