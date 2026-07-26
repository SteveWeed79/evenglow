'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  currentState,
  type Diagnostics,
  diagnostics,
  nudge,
  startSync,
  stopSync,
  subscribe,
  type SyncState,
} from '../sync/engine';
import { type EnqueueInput, enqueue } from '../sync/queue';
import { requestPersistence } from '../sync/storage';

const SERVER_STATE: SyncState = { kind: 'synced', at: null };

let snapshot: SyncState = SERVER_STATE;

function subscribeToEngine(onChange: () => void): () => void {
  return subscribe((state) => {
    snapshot = state;
    onChange();
  });
}

/** Starts the engine once for the app and exposes the current sync state. */
export function useSync(): SyncState {
  useEffect(() => {
    startSync();
    return stopSync;
  }, []);

  return useSyncExternalStore(
    subscribeToEngine,
    () => snapshot,
    () => SERVER_STATE, // no queue on the server; the shell renders 'Saved'
  );
}

/**
 * The write path.
 *
 * Returns as soon as the mutation is durable locally — it never awaits the
 * network (R6). The flush is nudged, not waited on, so a log is bounded by an
 * IndexedDB write rather than by signal.
 */
export function useLog(): (input: EnqueueInput) => Promise<void> {
  return useCallback(async (input: EnqueueInput) => {
    // Ask on first write, when the browser is most likely to grant it (A2).
    void requestPersistence();

    await enqueue(input);
    nudge();
  }, []);
}

export function useDiagnostics(open: boolean): Diagnostics | null {
  const [report, setReport] = useState<Diagnostics | null>(null);

  useEffect(() => {
    if (!open) return;

    let live = true;
    const read = () => {
      void diagnostics().then((next) => {
        if (live) setReport(next);
      });
    };

    read();
    const timer = setInterval(read, 2_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [open]);

  return report;
}

/** Reads state once without subscribing — for one-off checks. */
export async function readSyncState(): Promise<SyncState> {
  return currentState();
}
