import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the network listener tells the engine.
 *
 * The translation from a `NetworkStateEvent` to a boolean was the whole bug and
 * the one thing no test touched: `tests/unit/online.test.ts` and
 * `tests/offline/manual-sync.test.ts` both call `setOnline` directly with
 * booleans, so the line that decides WHICH boolean had no coverage at all.
 *
 * It read `setOnline(event.isConnected === true)`. `isConnected` is optional and
 * `addNetworkStateListener` leaves it `undefined` on some configurations, so on
 * those devices "did not say" became "offline" — and offline is the answer the
 * engine cannot recover from on its own, because the only thing that could set
 * it back is another event from the listener that never says anything. The
 * engine's own `nudge` documentation names that hazard word for word.
 */

const setOnline = vi.fn();
const nudge = vi.fn();
let listener: ((event: { isConnected?: boolean | undefined }) => void) | null = null;

vi.mock('expo-network', () => ({
  addNetworkStateListener: (fn: (event: { isConnected?: boolean | undefined }) => void) => {
    listener = fn;
    return { remove: () => undefined };
  },
}));

vi.mock('@homefarm/core/sync/engine', () => ({
  setOnline: (value: boolean) => setOnline(value),
  nudge: () => nudge(),
}));

// Keeps expo-secure-store out of the import graph; `wake()` is not what this
// suite is about.
vi.mock('../../apps/mobile/src/auth/session', () => ({
  refreshSession: () => Promise.resolve(undefined),
}));

const { startTriggers, stopTriggers } = await import('@homefarm/mobile/sync/triggers');

describe('the network listener', () => {
  beforeEach(() => {
    setOnline.mockClear();
    nudge.mockClear();
    listener = null;
    // One set per process now, so each case has to let go of the previous
    // one or `startTriggers` hands back the set whose listener is gone.
    stopTriggers();
    startTriggers();
    expect(listener).not.toBeNull();
  });

  /**
   * The regression. A phone showing four bars must not be reported offline
   * because the OS declined to answer.
   */
  it('says nothing to the engine when the OS says nothing', () => {
    listener!({});
    expect(setOnline).not.toHaveBeenCalled();

    listener!({ isConnected: undefined });
    expect(setOnline).not.toHaveBeenCalled();
  });

  it('reports what the OS actually said, both ways', () => {
    listener!({ isConnected: false });
    expect(setOnline).toHaveBeenLastCalledWith(false);

    listener!({ isConnected: true });
    expect(setOnline).toHaveBeenLastCalledWith(true);
  });

  /**
   * The engine defaults to online and stays there unless told otherwise, so
   * silence has to leave a device that was working alone.
   */
  it('leaves a working device alone across a silent event', () => {
    listener!({ isConnected: true });
    setOnline.mockClear();

    listener!({ isConnected: undefined });

    expect(setOnline).not.toHaveBeenCalled();
  });

  // `wake()` refreshes the session before nudging, so the nudge lands a
  // microtask later than the event that caused it.
  it('still wakes only on a reported regain', async () => {
    listener!({ isConnected: undefined });
    listener!({ isConnected: false });
    await vi.waitFor(() => expect(setOnline).toHaveBeenLastCalledWith(false));
    expect(nudge).not.toHaveBeenCalled();

    listener!({ isConnected: true });
    await vi.waitFor(() => expect(nudge).toHaveBeenCalled());
  });
});
