import type { LocalStore } from '@steading/app/db/port';
import { idbLocalStore } from './idb-store';

/**
 * The engine's handle on storage.
 *
 * A module-level provider rather than a parameter threaded through every call
 * site: the components call `useLog()`, not `useLog(store)`, and making the
 * store an argument would push a storage concern into every screen for no
 * benefit. This mirrors how `db()` already worked — one handle for the app —
 * while making the implementation swappable.
 *
 * Which is the point. Until now `queue.ts`, `flush.ts` and `pull.ts` called
 * IndexedDB directly, so `tests/offline` could only ever exercise one storage
 * layer. With the store injected, the engine's own suite runs against both,
 * and *that* is what proves the SQLite port rather than a separate suite
 * asserting the same things twice.
 *
 * Defaults to IndexedDB so nothing changes until S5 sets the SQLite store at
 * startup.
 */

let current: LocalStore | null = null;

export function setLocalStore(store: LocalStore): void {
  current = store;
}

export function localStore(): LocalStore {
  current ??= idbLocalStore();
  return current;
}

/** Tests only: drops the handle so the next call rebuilds it. */
export function resetLocalStore(): void {
  current = null;
}
