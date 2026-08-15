import { describe, expect, it } from 'vitest';
import { nextDelay, stillHydrating } from '@steading/core/sync/engine';
import type { PullOutcome } from '@steading/core/sync/pull';

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

/**
 * Hydration pacing, which the loop could not see at all.
 *
 * A device rebuilding its history reads `MAX_PAGES_PER_PASS` pages and then
 * waited out the full idle tick before asking for the next lot, whatever the
 * server had just told it. On a farm with years of records that is the
 * difference between a new phone filling in over minutes and over half an hour
 * — and half an hour of an empty app looks exactly like an app that does not
 * work. It also sets the cost of the one-time projection repair, which replays
 * the whole log by design.
 */
describe('pacing hydration', () => {
  it('goes straight on when more pages are waiting', () => {
    expect(nextDelay({ consecutiveFailures: 0, remaining: 0, resolved: 0, pullMore: true })).toEqual(
      { delay: 0, consecutiveFailures: 0 },
    );
  });

  it('idles when the history has run out', () => {
    expect(
      nextDelay({ consecutiveFailures: 0, remaining: 0, resolved: 0, pullMore: false }).delay,
    ).toBe(30_000);
  });

  /**
   * The outbox rules come first, and that is deliberate. A queue that will not
   * move must back off whatever hydration is doing, or a farm on a bad
   * connection spends its tick budget re-reading the log instead of waiting out
   * the failure that is actually blocking it.
   */
  it('does not let more pages defeat the backoff a stuck queue earned', () => {
    const next = nextDelay({
      consecutiveFailures: 0,
      remaining: 5,
      resolved: 0,
      pullMore: true,
    });

    expect(next.delay).toBeGreaterThan(0);
    expect(next.consecutiveFailures).toBe(1);
  });

  it('does not let more pages defeat an outstanding failure', () => {
    const next = nextDelay({
      consecutiveFailures: 3,
      remaining: 0,
      resolved: 0,
      pullMore: true,
    });

    expect(next.delay).toBeGreaterThan(0);
    expect(next.consecutiveFailures).toBe(3);
  });

  it('leaves the old shape alone', () => {
    // Omitting the field must read as "no more pages", so every existing
    // caller keeps the pacing it had.
    expect(nextDelay({ consecutiveFailures: 0, remaining: 0, resolved: 0 }).delay).toBe(30_000);
  });
});

/**
 * The guard that decides whether a pull earned the fast path.
 *
 * `more` on its own is not enough, and the case that proves it is the pause:
 * `applyPulled` stops at a record this device still owes and returns without
 * advancing, so the page it reports is one only a FLUSH can get past. Going
 * again immediately on that would spin at zero delay until the queue drained.
 */
describe('whether a pull earned the fast path', () => {
  const outcome = (over: Partial<PullOutcome> = {}): PullOutcome => ({
    applied: 0,
    skipped: 0,
    through: 0,
    more: false,
    ...over,
  });

  it('takes it when a page landed rows and more are waiting', () => {
    expect(stillHydrating(outcome({ applied: 200, more: true }))).toBe(true);
  });

  it('refuses it when nothing landed, however much is waiting', () => {
    // The paused pull: more pages, no progress, and only a flush can help.
    expect(stillHydrating(outcome({ applied: 0, more: true }))).toBe(false);
  });

  it('refuses it at the end of the history', () => {
    expect(stillHydrating(outcome({ applied: 200, more: false }))).toBe(false);
  });

  it('refuses it when the pull never returned', () => {
    expect(stillHydrating(undefined)).toBe(false);
  });
});
