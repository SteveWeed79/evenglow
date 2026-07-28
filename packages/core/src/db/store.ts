import type { LocalStore } from './port';

/**
 * The engine's handle on storage.
 *
 * A module-level provider rather than a parameter threaded through every call
 * site: components call `useLog()`, not `useLog(store)`, and making the store
 * an argument would push a storage concern into every screen for no benefit.
 *
 * **There is no default, and that is the point.** It used to fall back to
 * IndexedDB if nobody had set one, which is how the migration's worst bug
 * happened: on a handset the reads resolved to a browser database that had
 * never been written to, so adding stock silently did nothing and the screen
 * showed a farm with no animals. A lazy default cannot be wrong loudly — it
 * can only be wrong quietly.
 *
 * So an unset store throws, naming the fix. There is exactly one storage
 * implementation now, and exactly one place that installs it.
 */

let current: LocalStore | null = null;

export function setLocalStore(store: LocalStore): void {
  current = store;
}

export function localStore(): LocalStore {
  if (current === null) {
    throw new Error(
      'No local store installed. Call setLocalStore() during startup — see apps/mobile/src/db/store.ts.',
    );
  }
  return current;
}

/** Tests only: drops the handle so the next call must install one again. */
export function resetLocalStore(): void {
  current = null;
}
