import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SWEEP_AFTER_MS,
  SWEEP_EVERY_MS,
  type SweepReport,
  startSweeper,
} from '@steading/api/sync/sweep';

/**
 * The timer around the sweep, which is the half that can go wrong quietly.
 *
 * The sweep itself needs a mongod and is asserted in `tests/sync/sweeper.test.ts`.
 * What is testable without one is what a background job actually fails at:
 * overlapping itself when a pass runs long, and taking the process down when a
 * pass throws. Neither shows up in a test of the sweep, and both would show up
 * on a farm's server at three in the morning.
 *
 * **The sweep is passed in rather than spied on**, and the first draft of this
 * file is why. `vi.spyOn(module, 'sweepAllFarms')` replaces a namespace
 * property, and an ESM call site holds its local binding — so the spy never
 * intercepted, the real sweep ran against a mocked database, and the assertions
 * failed for a reason that had nothing to do with what they were testing. A
 * seam the runner genuinely has is better than one a test pretends it has.
 */

const NOTHING: SweepReport = { found: 0, decided: 0, unreadable: 0, orphaned: 0 };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the sweeper’s timer', () => {
  /**
   * A restart is exactly when a stranded row exists — the window being closed
   * is a crash between the log write and the projection — so waiting a full
   * hour after coming back up would be waiting through the likeliest moment for
   * there to be something to find.
   */
  it('runs a first pass shortly after boot, not an hour later', async () => {
    const sweep = vi.fn().mockResolvedValue(NOTHING);
    const stop = startSweeper({ sweep, settleMs: 60_000, everyMs: 3_600_000 });

    await vi.advanceTimersByTimeAsync(59_000);
    expect(sweep).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(sweep).toHaveBeenCalledTimes(1);

    stop();
  });

  it('waits an hour before deciding a row, and sweeps on the same hour', () => {
    expect(SWEEP_AFTER_MS).toBe(60 * 60 * 1000);
    expect(SWEEP_EVERY_MS).toBe(SWEEP_AFTER_MS);
  });

  /**
   * A farm with a backlog could otherwise have two passes projecting the same
   * envelopes at once. The lane and `stampOutcome`'s filter make that safe
   * rather than corrupting — it is wasted work that grows exactly when the
   * server is already behind.
   */
  it('does not start a second pass while the first is still running', async () => {
    let finish: ((report: SweepReport) => void) | undefined;
    const sweep = vi.fn().mockImplementation(
      () =>
        new Promise<SweepReport>((resolve) => {
          finish = resolve;
        }),
    );

    const stop = startSweeper({ sweep, settleMs: 10, everyMs: 1_000 });

    await vi.advanceTimersByTimeAsync(20);
    expect(sweep).toHaveBeenCalledTimes(1);

    // Several ticks go by with the first pass still in flight.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sweep).toHaveBeenCalledTimes(1);

    finish?.(NOTHING);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sweep).toHaveBeenCalledTimes(2);

    stop();
  });

  /**
   * An unhandled rejection in a timer callback takes the process down, and a
   * sweeper that kills the API is worse than no sweeper. There is no state to
   * lose either: every row it did not reach is still `pending`.
   */
  it('survives a pass that throws, and tries again on the next one', async () => {
    const sweep = vi
      .fn()
      .mockRejectedValueOnce(new Error('mongo went away'))
      .mockResolvedValue(NOTHING);

    const said: string[] = [];
    const stop = startSweeper({ sweep, settleMs: 10, everyMs: 1_000, report: (l) => said.push(l) });

    await vi.advanceTimersByTimeAsync(20);
    expect(said.join(' ')).toContain('mongo went away');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sweep).toHaveBeenCalledTimes(2);

    stop();
  });

  /** Silent on the ordinary hour, which is every hour. */
  it('says nothing when there was nothing to decide', async () => {
    const said: string[] = [];
    const stop = startSweeper({
      sweep: vi.fn().mockResolvedValue(NOTHING),
      settleMs: 10,
      everyMs: 3_600_000,
      report: (l) => said.push(l),
    });

    await vi.advanceTimersByTimeAsync(20);

    expect(said).toEqual([]);
    stop();
  });

  it('says what it decided when it decided something', async () => {
    const said: string[] = [];
    const stop = startSweeper({
      sweep: vi.fn().mockResolvedValue({ found: 3, decided: 2, unreadable: 1, orphaned: 0 }),
      settleMs: 10,
      everyMs: 3_600_000,
      report: (l) => said.push(l),
    });

    await vi.advanceTimersByTimeAsync(20);

    expect(said).toHaveLength(1);
    expect(said[0]).toContain('3 undecided');
    expect(said[0]).toContain('2 decided');
    expect(said[0]).toContain('1 unreadable');

    stop();
  });

  /** Stopping means stopping, so a shutdown is not left waiting on a timer. */
  it('stops when it is told to', async () => {
    const sweep = vi.fn().mockResolvedValue(NOTHING);
    startSweeper({ sweep, settleMs: 10, everyMs: 1_000 })();

    await vi.advanceTimersByTimeAsync(120_000);

    expect(sweep).not.toHaveBeenCalled();
  });
});
