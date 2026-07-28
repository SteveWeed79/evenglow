import type { LocalStore } from '@steading/app/db/port';
import { openSqliteStore } from '@steading/app/db/sqlite-store';
import { setLocalStore } from '@steading/app/db/store';
import { openExpoSqlDriver } from './open';

/**
 * Opening the local store, once, at startup.
 *
 * Deliberately explicit rather than lazy. The web build defaulted the store
 * provider to IndexedDB and set SQLite later, and the gap between those two
 * facts was the worst bug of the migration: reads went to a database that had
 * never been written to, and adding stock silently did nothing. Here there is
 * one store, installed before the first screen renders, or the app does not
 * start.
 *
 * `@steading/app` is imported for the store and the port — 3,700 lines that
 * have no DOM in them and are proven by the existing suite. They move to
 * `packages/core` at R3, when the IndexedDB implementation beside them is
 * deleted and the package stops being "the web app" at all.
 */

let opened: Promise<LocalStore> | null = null;

export function openLocalStore(): Promise<LocalStore> {
  // Memoised on the promise, not the result: two callers racing at startup
  // must not open two connections and run the migration ladder twice.
  opened ??= (async () => {
    const store = await openSqliteStore(await openExpoSqlDriver());
    setLocalStore(store);
    return store;
  })();
  return opened;
}

/** Tests only: drops the handle so the next call rebuilds it. */
export function resetLocalStoreHandle(): void {
  opened = null;
}
