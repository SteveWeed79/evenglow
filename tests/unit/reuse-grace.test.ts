import { describe, expect, it } from 'vitest';
import { reuseVerdict } from '@steading/api/auth/refresh';

/**
 * The decision that either keeps a farm signed in or sends it to a password
 * prompt.
 *
 * ## Why this is a unit test and not part of the isolation suite
 *
 * `rotateSession` needs a real mongod, and CI has one. The machine this was
 * written on does not and cannot get one — `fastdl.mongodb.org` is blocked by
 * network policy, so `mongodb-memory-server` has no binary to download. Pushing
 * a change to session handling and letting CI be the first thing that runs it
 * is how the previous round failed: a second file asserted the old behaviour
 * and nothing local could have said so.
 *
 * So the arithmetic lives in a pure function. The wiring still depends on CI;
 * the rule does not.
 *
 * ## The rule
 *
 * Rotation with reuse detection is RFC 9700, and with no tolerance it signs
 * people out for things no client can avoid — a process killed between the
 * server rotating and the device writing the replacement, or a request that
 * timed out after the server had handled it. Thirty seconds of grace, which is
 * Okta's default for the same problem.
 */

const GRACE_MS = 30_000;
const NOW = new Date('2026-08-11T09:00:00.000Z');

const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

describe('a token that has never been exchanged', () => {
  it('is fresh', () => {
    expect(reuseVerdict(undefined, NOW)).toBe('fresh');
  });
});

describe('a token presented again', () => {
  /** The retry a killed process makes on its next launch, seconds later. */
  it('is this app retrying, inside the window', () => {
    expect(reuseVerdict(ago(1), NOW)).toBe('within-grace');
    expect(reuseVerdict(ago(5_000), NOW)).toBe('within-grace');
  });

  /**
   * The boundary, asserted on both sides because it is the whole of the
   * security trade: everything inside it is a session kept, everything outside
   * it is a family revoked.
   */
  it('is still tolerated at exactly the limit', () => {
    expect(reuseVerdict(ago(GRACE_MS), NOW)).toBe('within-grace');
  });

  it('is theft one millisecond later', () => {
    expect(reuseVerdict(ago(GRACE_MS + 1), NOW)).toBe('stolen');
  });

  /** An attacker replaying a token from earlier in the chain, hours on. */
  it('is theft when it comes back much later', () => {
    expect(reuseVerdict(ago(60 * 60 * 1000), NOW)).toBe('stolen');
  });
});

/**
 * A clock that goes backwards — NTP stepping, a container resuming, a phone
 * crossing a timezone with a bad RTC — must never be able to sign a farm out.
 * The elapsed time goes negative, which is not "more than thirty seconds".
 */
describe('a clock that disagrees with itself', () => {
  it('does not turn skew into theft', () => {
    expect(reuseVerdict(new Date(NOW.getTime() + 60_000), NOW)).toBe('within-grace');
  });
});
