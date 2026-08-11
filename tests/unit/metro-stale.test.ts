import { describe, expect, it } from 'vitest';
import { cacheIsStale, majorOf } from '../../scripts/lib/metro-stale.mjs';

/**
 * Metro's cache after a Node upgrade.
 *
 * The cache is V8-serialized, and that format belongs to the V8 that wrote it.
 * Upgrade Node and the old cache is unreadable:
 *
 *   Error while reading cache, falling back to a full crawl:
 *    Error: Unable to deserialize cloned data due to invalid or unsupported
 *    version.
 *
 * Fifteen frames of stack for something Metro then recovers from by itself.
 * Nothing is broken — but it costs a full crawl on every start until the cache
 * is replaced, and it prints a wall of red that reads exactly like a fault.
 * Reported from a machine on Node 25 reading a cache written by an older one.
 */
describe('reading a Node version', () => {
  it('takes the major, with or without the v', () => {
    expect(majorOf('v25.9.0')).toBe('25');
    expect(majorOf('22.22.2')).toBe('22');
  });

  it('says nothing about something that is not a version', () => {
    expect(majorOf('')).toBeNull();
    expect(majorOf(undefined)).toBeNull();
    expect(majorOf('unknown')).toBeNull();
  });
});

describe('whether the cache should go', () => {
  it('goes when the major changed', () => {
    expect(cacheIsStale('v22.22.2', 'v25.9.0')).toBe(true);
  });

  /**
   * V8's serializer format does not move within a major, and clearing on
   * 25.9.0 → 25.9.1 would spend a full crawl to avoid a warning that was never
   * coming.
   */
  it('stays for a patch or a minor', () => {
    expect(cacheIsStale('v25.9.0', 'v25.9.1')).toBe(false);
    expect(cacheIsStale('v25.1.0', 'v25.9.0')).toBe(false);
  });

  /**
   * Unknown on either side means leave it alone. A cache that might be fine is
   * worth more than a crawl bought with a guess — and a machine that has never
   * run this has nothing to be stale relative to.
   */
  it('leaves it alone when either side is unknown', () => {
    expect(cacheIsStale(null, 'v25.9.0')).toBe(false);
    expect(cacheIsStale('v25.9.0', undefined)).toBe(false);
    expect(cacheIsStale('nonsense', 'v25.9.0')).toBe(false);
  });
});
