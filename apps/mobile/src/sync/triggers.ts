import { AppState, type AppStateStatus } from 'react-native';
import { addNetworkStateListener, type NetworkStateEvent } from 'expo-network';
import { nudge, setOnline } from '@homefarm/core/sync/engine';
import { reportEngineError } from '@homefarm/core/sync/report';
import { refreshSession } from '../auth/session';

/**
 * The two sync triggers a timer cannot replace (sync contract, CLAUDE.md).
 *
 * Without these the queue waits out the 30-second idle tick, and the first
 * thing a keeper does after walking back into signal is open the app and look
 * at the sync chip. Thirty seconds of "12 waiting" while standing in the yard
 * with two bars is how an app teaches someone not to trust it.
 *
 * **Resume matters more than connectivity here.** A phone in a pocket in a
 * barn is not a phone that lost the network — it is a phone whose process was
 * frozen. Android suspends timers for a backgrounded app, so the idle tick
 * does not fire at all while the app is away, and resume is the only moment
 * the engine reliably hears about.
 */

/** The state the OS reports when the app is in the foreground and interactive. */
const ACTIVE: AppStateStatus = 'active';

export interface TriggerHandles {
  stop(): void;
}

/**
 * Refresh the session, then nudge.
 *
 * Access tokens are short-lived, and the two moments this fires are exactly
 * the two where one is most likely to have expired unnoticed: the app has
 * been backgrounded, or the device has been out of signal. Flushing first
 * would spend a round trip discovering a 401 the refresh was going to fix.
 *
 * A failed refresh is not a failed nudge. When the request itself fails the
 * session is kept and the flush still runs — it will queue, which is correct
 * — and only a server that actually refuses ends the session.
 *
 * This is not an on-401 refresh, and it is worth saying why. The engine
 * reports `deferred: 'unauthenticated'` internally but does not surface the
 * reason to a subscriber, so acting on it immediately would need a hook that
 * does not exist. Refreshing on resume and on regain covers the cases a token
 * actually expires in; the cost of not having the hook is one wasted flush in
 * the rare case a token expires while the app is open and online.
 */
async function wake(): Promise<void> {
  await refreshSession().catch(() => undefined);
  nudge();
}

/**
 * Each listener is attached on its own, and neither can stop the app.
 *
 * These are an **optimisation**. Without them the engine still flushes on its
 * idle tick and on every enqueue; what is lost is promptness, not work. So a
 * platform that cannot provide one of them must cost a farm a few seconds of
 * latency, never the app.
 *
 * That was not true before, and it cost a whole boot: `addNetworkStateListener`
 * threw on a device, `startTriggers` had no guard, `start()` had no guard
 * around `startTriggers`, and the failure arrived as a full-screen "Steading
 * could not start" on a farm whose records were sitting on the device,
 * perfectly readable, behind a screen that would not open.
 */
export function startTriggers(): TriggerHandles {
  const stops: Array<() => void> = [];

  try {
    let previous = AppState.currentState;

    const app = AppState.addEventListener('change', (next) => {
      // Only on the transition INTO active. Android reports 'inactive' on the
      // way past in some transitions, and nudging on every state change would
      // fire two or three times for one glance at the screen.
      if (next === ACTIVE && previous !== ACTIVE) void wake();
      previous = next;
    });

    stops.push(() => app.remove());
  } catch (error) {
    reportEngineError('watching for the app waking up', error);
  }

  try {
    const network = addNetworkStateListener((event: NetworkStateEvent) => {
      // Only on regain. A disconnect needs no nudge: the flush defers and the
      // queue is already the plan.
      //
      // `isInternetReachable` is deliberately not required. It is undefined on
      // some Android configurations and false on a captive portal, and a farm
      // wifi that has not been signed into is exactly where a keeper still
      // wants the attempt made — the flush finding out is cheaper than not
      // trying.
      /**
       * Reported both ways, not just on regain.
       *
       * The engine's own online check has no way to ask a native module, so
       * this is the only thing that can tell it. Losing the network matters as
       * much as regaining it: without the `false` the engine spends a flush
       * and a backoff discovering what the OS already knew.
       *
       * **Only what the OS actually said.** This was
       * `setOnline(event.isConnected === true)`, which collapses "no" and
       * "did not say" into the same answer — and they are not the same answer.
       * `isConnected` is optional and `addNetworkStateListener` leaves it
       * `undefined` on some configurations, so on those devices the first
       * event reported offline on a phone showing four bars. `tick` then takes
       * the offline branch, schedules another tick, and returns without
       * flushing or pulling; nothing sets it back, because the only thing that
       * could is another event from the listener that never says anything.
       * `wake()` on resume calls `nudge()` without `force`, so it schedules a
       * tick that immediately takes the same branch again. Sync stopped for
       * the life of the process, behind a chip that looked healthy — and the
       * manual "Try sending now" button worked, which is exactly why it
       * survived testing.
       *
       * The engine's own `nudge` documentation already named this hazard
       * verbatim. The listener never got the memo.
       */
      if (event.isConnected !== undefined) setOnline(event.isConnected);
      if (event.isConnected === true) void wake();
    });

    stops.push(() => network.remove());
  } catch (error) {
    reportEngineError('watching for the network coming back', error);
  }

  return {
    stop() {
      for (const stop of stops) {
        // One listener that will not detach must not strand the others.
        try {
          stop();
        } catch (error) {
          reportEngineError('letting go of a sync trigger', error);
        }
      }
    },
  };
}
