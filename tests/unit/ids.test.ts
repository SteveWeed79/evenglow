import { afterEach, describe, expect, it } from 'vitest';
import { configureIds, isUlid, newId, resetIds } from '@homefarm/contracts';

/**
 * The random source a handset does not have.
 *
 * `ulid` detects its own: it looks for `crypto.getRandomValues` on the global
 * and throws when there is none. React Native aliases `window` to the global
 * and puts no `crypto` on it, and neither `react-native` nor `expo` installs
 * one — verified against the installed packages, and reproduced by running
 * ulid's browser build with the global reshaped:
 *
 *     ulid() THREW -> Failed to find a reliable PRNG (PRNG_DETECT)
 *
 * Node has `crypto`, so the whole suite has always been minting IDs through a
 * global the phone was never going to provide. This is the seam that removes
 * the guess.
 */

afterEach(() => {
  resetIds();
});

describe('minting an id', () => {
  it('works with no source configured, as the server and the tests do', () => {
    // Node finds crypto. Nothing regressed for anything that never configured.
    expect(isUlid(newId())).toBe(true);
  });

  it('uses the source it was given', () => {
    let asked = 0;
    configureIds(() => {
      asked += 1;
      return 0.5;
    });

    expect(isUlid(newId())).toBe(true);
    expect(asked).toBeGreaterThan(0);
  });

  it('is still a ULID when the platform supplies the randomness', () => {
    // The shape is load-bearing: it is the mutation's `_id` and the server's
    // idempotency key, and `databaseNameFor` asserts it before using it as a
    // filename.
    configureIds(() => 0.42);
    for (let i = 0; i < 50; i += 1) expect(isUlid(newId())).toBe(true);
  });

  it('does not repeat itself inside one millisecond', () => {
    /**
     * The reason this matters more than it looks: the ULID is the idempotency
     * key and the server dedupes with `$setOnInsert`. A repeat means a
     * genuinely new mutation is answered `duplicate` and the record is lost
     * with no rejection and no inbox row — the one failure mode that is
     * silent.
     *
     * A constant PRNG is the worst case a real source could degrade to, and
     * the monotonic factory still has to pull them apart.
     */
    configureIds(() => 0.5);
    const minted = new Set(Array.from({ length: 500 }, () => newId()));
    expect(minted.size).toBe(500);
  });

  it('sorts in the order it was minted', () => {
    configureIds(() => 0.5);
    const minted = Array.from({ length: 100 }, () => newId());
    expect([...minted].sort()).toEqual(minted);
  });

  it('goes back to detection when the source is dropped', () => {
    configureIds(() => 0.5);
    resetIds();
    expect(isUlid(newId())).toBe(true);
  });
});
