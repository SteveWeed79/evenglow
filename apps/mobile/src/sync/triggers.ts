import { AppState, type AppStateStatus } from 'react-native';
import { addNetworkStateListener, type NetworkStateEvent } from 'expo-network';
import { nudge } from '@steading/app/sync/engine';

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

export function startTriggers(): TriggerHandles {
  let previous = AppState.currentState;

  const app = AppState.addEventListener('change', (next) => {
    // Only on the transition INTO active. Android reports 'inactive' on the
    // way past in some transitions, and nudging on every state change would
    // fire two or three times for one glance at the screen.
    if (next === ACTIVE && previous !== ACTIVE) nudge();
    previous = next;
  });

  const network = addNetworkStateListener((event: NetworkStateEvent) => {
    // Only on regain. A disconnect needs no nudge: the flush defers and the
    // queue is already the plan.
    //
    // `isInternetReachable` is deliberately not required. It is undefined on
    // some Android configurations and false on a captive portal, and a farm
    // wifi that has not been signed into is exactly where a keeper still wants
    // the attempt made — the flush finding out is cheaper than not trying.
    if (event.isConnected === true) nudge();
  });

  return {
    stop() {
      app.remove();
      network.remove();
    },
  };
}
