import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { nudge } from './engine';

/**
 * The two sync triggers a browser cannot give us (sync contract, CLAUDE.md).
 *
 * `window.online` does not fire when an Android app is resumed from the
 * background, and it is unreliable about a handset moving between a dead cell
 * and a barn's wifi — which is most of what a farm's connectivity actually
 * looks like. Without these the queue waits for the 30-second timer, and the
 * first thing a keeper does after coming back into signal is open the app and
 * look at the sync chip.
 *
 * Returns its own teardown. Both listeners resolve asynchronously, so the
 * handles are awaited rather than fired and forgotten — a listener that
 * outlives the app instance that registered it nudges an engine that has
 * already stopped.
 */
export async function startNativeTriggers(): Promise<() => void> {
  const resumed = await App.addListener('resume', () => nudge());

  const reconnected = await Network.addListener('networkStatusChange', (status) => {
    // Only on regain. A disconnect needs no nudge: the flush will defer and
    // the queue is already the plan.
    if (status.connected) nudge();
  });

  return () => {
    void resumed.remove();
    void reconnected.remove();
  };
}
