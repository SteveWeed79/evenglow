import { useCallback, useSyncExternalStore } from 'react';
import { nudge, subscribe, type SyncState } from '@steading/core/sync/engine';
import { type EnqueueInput, enqueue } from '@steading/core/sync/queue';

/**
 * The engine's state, and the write path.
 *
 * Thinner than the web version by two things, both of which were browser
 * problems rather than app problems:
 *
 * - **The engine is not started here.** `boot/start.ts` starts it once, before
 *   any screen renders. Starting it from a hook meant the loop's lifetime was
 *   tied to whichever component happened to mount first.
 * - **No storage-persistence request.** That asked a browser not to evict an
 *   origin after a week of idleness. An app-sandbox file is not evicted, so
 *   there is nothing to ask and nobody to ask it of.
 */

const INITIAL: SyncState = { kind: 'synced', at: null };

let snapshot: SyncState = INITIAL;

function subscribeToEngine(onChange: () => void): () => void {
  return subscribe((state) => {
    snapshot = state;
    onChange();
  });
}

export function useSync(): SyncState {
  return useSyncExternalStore(subscribeToEngine, () => snapshot);
}

/**
 * The write path.
 *
 * Returns as soon as the mutation is durable locally — it never awaits the
 * network (R6). The flush is nudged, not waited on, so a log is bounded by one
 * SQLite transaction rather than by signal.
 */
export function useLog(): (input: EnqueueInput) => Promise<void> {
  return useCallback(async (input: EnqueueInput) => {
    await enqueue(input);
    nudge();
  }, []);
}
