/**
 * Single-flight across contexts.
 *
 * On a device there is one WebView, so `flushOnce`'s in-process guard is
 * already enough. The browser dev loop is not so tidy: two tabs on the same
 * origin share one database, and two flush loops racing it would send the same
 * batch twice and resolve each other's rows. Idempotency at the server makes
 * that survivable rather than correct — the duplicate work still burns
 * attempts and can clear a row the other tab is mid-way through updating.
 *
 * Web Locks is the primitive for this. Where it is missing the fallback is an
 * in-process mutex, which is exactly as strong as the single-WebView case
 * needs and honestly weaker than the multi-tab one.
 */

export const SYNC_LOCK = 'steading:sync';

interface LockManagerLike {
  request<T>(
    name: string,
    options: { ifAvailable: boolean },
    fn: (lock: unknown) => Promise<T | null>,
  ): Promise<T | null>;
}

function lockManager(): LockManagerLike | null {
  if (typeof navigator === 'undefined') return null;
  const locks = (navigator as Navigator & { locks?: LockManagerLike }).locks;
  return locks ?? null;
}

let held = false;

/**
 * Runs `fn` under the named lock, or returns null if someone else holds it.
 *
 * `ifAvailable` rather than waiting, deliberately: if another context is
 * already flushing, this one has nothing to add by queueing behind it. Waiting
 * would just stack timers.
 */
export async function withSyncLock<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  const locks = lockManager();

  if (!locks) {
    if (held) return null;
    held = true;
    try {
      return await fn();
    } finally {
      held = false;
    }
  }

  return locks.request<T>(name, { ifAvailable: true }, async (lock) => {
    // A null lock means it was not available — someone else is flushing.
    if (lock === null) return null;
    return fn();
  });
}
