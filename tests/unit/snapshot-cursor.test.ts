import { describe, expect, it } from 'vitest';
import { parseSnapshotCursor } from '@homefarm/api/sync/snapshot';

/**
 * The hydration cursor's validation, without a database.
 *
 * Deliberately covered here rather than only through the db-backed parity
 * suite. Both servers depend on this function, and the last time a
 * cross-cutting behaviour was reachable only through a suite that half the
 * environments cannot run, CI found a 429 being reported as a 500 that nobody
 * could reproduce locally.
 */

describe('parseSnapshotCursor', () => {
  it('defaults to the beginning when no cursor is given', () => {
    expect(parseSnapshotCursor(null, null)).toEqual({ since: 0, sinceId: null });
    expect(parseSnapshotCursor(undefined, undefined)).toEqual({ since: 0, sinceId: null });
  });

  it('accepts a full cursor pair', () => {
    const id = '01JABCDEFGHJKMNPQRSTVWXYZ0';
    expect(parseSnapshotCursor('1700000000000', id)).toEqual({
      since: 1_700_000_000_000,
      sinceId: id,
    });
  });

  it.each([
    ['not-a-number', 'nonsense'],
    ['-1', 'a negative watermark'],
    ['', 'a parameter sent blank'],
    ['NaN', 'the literal NaN'],
  ])('refuses %s (%s)', (since) => {
    expect(() => parseSnapshotCursor(since, null)).toThrow(/starting point/);
  });

  it.each([
    ['too-short', 'a truncated id'],
    ['0123456789012345678901234567', 'an over-long id'],
  ])('refuses %s (%s)', (sinceId) => {
    expect(() => parseSnapshotCursor('0', sinceId)).toThrow(/starting point/);
  });

  /**
   * Fastify's query parser returns an ARRAY for a repeated parameter, so
   * `?since=1&since=2` arrives as `['1','2']` despite the declared type.
   * Number() on that yields NaN and would fail safely by luck; this asserts it
   * fails by design.
   */
  it.each([
    [['1', '2'], 'a repeated since'],
    [{ toString: () => '0' }, 'an object that stringifies'],
    [0, 'a number rather than a string'],
  ] as [unknown, string][])('refuses a non-string since (%#: %s)', (since) => {
    expect(() => parseSnapshotCursor(since, null)).toThrow(/starting point/);
  });

  it('refuses a repeated sinceId', () => {
    const id = '01JABCDEFGHJKMNPQRSTVWXYZ0';
    expect(() => parseSnapshotCursor('0', [id, id])).toThrow(/starting point/);
  });

  /**
   * **The one input this function said it refused and did not.**
   *
   * Its own docstring is *"Rejects a malformed cursor rather than defaulting it
   * to everything"*. `new Date(1e30)` is an Invalid Date, and BSON serialises
   * one to **epoch 0** without complaining — so `?since=1e30` became
   * `serverTs > 1970` and returned the farm's entire history, while the caller
   * believed it had asked for everything after a point in the far future.
   *
   * Asserted around the boundary rather than at one value, because the number
   * that matters is what a `Date` can hold, not anything about this farm.
   */
  it('accepts the largest instant a Date can actually hold', () => {
    expect(parseSnapshotCursor('8640000000000000', null).since).toBe(8_640_000_000_000_000);
  });

  it('refuses a since one millisecond past what a Date can hold', () => {
    expect(() => parseSnapshotCursor('8640000000000001', null)).toThrow(/starting point/);
  });

  it('refuses a since so large it would silently mean the beginning of time', () => {
    expect(() => parseSnapshotCursor('1e30', null)).toThrow(/starting point/);
    // The shape of the bug, kept beside the assertion: this is what the query
    // would have carried.
    expect(new Date(1e30).getTime()).toBeNaN();
  });

  it('gives one message for every malformed cursor', () => {
    const messages = [
      () => parseSnapshotCursor('nope', null),
      () => parseSnapshotCursor('-1', null),
      () => parseSnapshotCursor('0', 'short'),
      () => parseSnapshotCursor(['1'], null),
    ].map((f) => {
      try {
        f();
        return 'accepted';
      } catch (e) {
        return (e as Error).message;
      }
    });

    expect(new Set(messages).size).toBe(1);
  });
});
