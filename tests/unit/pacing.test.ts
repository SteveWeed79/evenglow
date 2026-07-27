import { describe, expect, it } from 'vitest';
import { nextDelay } from '@steading/app/sync/engine';

/**
 * The scheduling rule, which is where a live hot loop lived.
 *
 * The old rule was "work left in the queue, so go again now". That is true
 * after a batch of 150 has sent its first 100 — and it is equally true after
 * a round trip that resolved nothing at all, which is the case a server
 * answering 200 with an empty results array produces. Nothing throws, nothing
 * is deferred, the queue is untouched, and the loop reschedules for zero
 * milliseconds forever: about sixty flush-and-pull pairs a second for as long
 * as the tab stays open. It was found by watching a dev server log scroll.
 */

describe('pacing', () => {
  it('rests when there is nothing to do', () => {
    expect(nextDelay({ consecutiveFailures: 0, remaining: 0, resolved: 0 }).delay).toBe(30_000);
  });

  it('goes straight on when a batch moved and more is waiting', () => {
    // The legitimate zero — a 100-mutation cap with work behind it.
    expect(nextDelay({ consecutiveFailures: 0, remaining: 40, resolved: 100 }).delay).toBe(0);
  });

  /** The regression. */
  it('never returns zero for a round trip that resolved nothing', () => {
    const next = nextDelay({ consecutiveFailures: 0, remaining: 1, resolved: 0 });

    expect(next.delay).toBeGreaterThan(0);
    // And it is remembered, so the next fruitless tick waits longer again.
    expect(next.consecutiveFailures).toBe(1);
  });

  it('lengthens the wait as fruitless ticks stack up', () => {
    let failures = 0;
    const delays: number[] = [];

    for (let i = 0; i < 5; i++) {
      const next = nextDelay({ consecutiveFailures: failures, remaining: 1, resolved: 0 });
      failures = next.consecutiveFailures;
      delays.push(next.delay);
    }

    expect(failures).toBe(1);
    // Backoff is jittered, so assert the floor rather than exact values: five
    // ticks must not fit inside a second between them.
    expect(delays.reduce((a, b) => a + b, 0)).toBeGreaterThan(1_000);
  });

  it('keeps backing off while a real failure is outstanding', () => {
    const next = nextDelay({ consecutiveFailures: 3, remaining: 1, resolved: 0 });

    expect(next.delay).toBeGreaterThan(0);
    // An unresolved failure is not compounded a second time by the same tick.
    expect(next.consecutiveFailures).toBe(3);
  });

  it('clears the failure count once the queue is empty', () => {
    expect(nextDelay({ consecutiveFailures: 0, remaining: 0, resolved: 12 })).toEqual({
      delay: 30_000,
      consecutiveFailures: 0,
    });
  });
});
