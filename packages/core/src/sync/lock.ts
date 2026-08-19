/**
 * Cross-tab coordination.
 *
 * Single-flight in flush.ts and pull.ts is per-JavaScript-context, so two open
 * tabs each hold their own guard and both sync at once. The server is
 * idempotent, so that is not a correctness bug — but it doubles requests,
 * races the pull watermark, and makes the queue depth flicker while a farmer
 * is watching it to decide whether their morning's work is safe.
 *
 * Web Locks is the right primitive and is available everywhere the app
 * targets. Where it is not, the fallback is to proceed: a duplicated flush is
 * a far smaller problem than a device that never syncs.
 */

export const SYNC_LOCK = 'homefarm:sync';

export async function withSyncLock<T>(name: string, run: () => Promise<T>): Promise<T | null> {
  if (typeof navigator === 'undefined' || !navigator.locks) return run();

  return navigator.locks.request(
    name,
    // Do not queue behind the other tab. If it holds the lock it is already
    // doing this work, and piling up waiters would fire a burst the moment it
    // released.
    { ifAvailable: true },
    async (lock) => (lock ? run() : null),
  );
}
