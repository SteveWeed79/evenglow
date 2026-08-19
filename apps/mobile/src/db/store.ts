import { randomUUID } from 'expo-crypto';
import type { LocalStore } from '@homefarm/core/db/port';
import { openSqliteStore } from '@homefarm/core/db/sqlite-store';
import { setLocalStore } from '@homefarm/core/db/store';
import { databaseNameFor, forgetDatabase, openExpoSqlDriver } from './open';

/**
 * Opening the local store, once, for one farm.
 *
 * Deliberately explicit rather than lazy. The web build defaulted the store
 * provider to IndexedDB and set SQLite later, and the gap between those two
 * facts was the worst bug of the migration: reads went to a database that had
 * never been written to, and adding stock silently did nothing. Here there is
 * one store, installed before the first screen renders, or the app does not
 * start.
 *
 * **Keyed by orgId**, which is why the session has to be established before
 * this is called: you cannot open the right database until you know whose it
 * is. Signing in as a second farm on a shared tablet opens a different file,
 * so the first farm's records are not merely hidden — they are somewhere else.
 *
 * `@homefarm/app` is imported for the store and the port — 3,700 lines that
 * have no DOM in them and are proven by the existing suite. They move to
 * `packages/core` when the web client retires.
 */

let opened: { orgId: string; store: Promise<LocalStore> } | null = null;

/**
 * Farms whose database should go once its connection is closed.
 *
 * **Deferred rather than deleted on the spot, because the file is still open.**
 * The only moment a farm is known to be disposable is while it is the one the
 * app is looking at, and `deleteDatabaseAsync` on an open database does not
 * work. This is the handover: whoever decides marks it, and the switch below —
 * the one place that knows the outgoing connection has actually closed —
 * carries it out.
 *
 * In-process, so a device that dies between the mark and the switch keeps the
 * file. That is the state it would have been in anyway, and an empty farm left
 * behind is exactly what this is trying to avoid rather than something it makes
 * worse.
 */
const disposable = new Set<string>();

/** Marks a farm's database for deletion at the next store switch. */
export function disposeWhenClosed(orgId: string): void {
  disposable.add(orgId);
}

/**
 * Deletes it, if it was marked. Answers whether it was.
 *
 * Separate from the switch that calls it so the rule can be tested without a
 * native SQLite connection to open — `openDatabaseAsync` is the one module
 * boundary the suite stubs rather than runs.
 *
 * `delete` both asks and clears, so a farm cannot be disposed of twice, and an
 * id nobody marked is left alone rather than deleted on the strength of having
 * been closed.
 */
export async function disposeIfMarked(orgId: string): Promise<boolean> {
  if (!disposable.delete(orgId)) return false;

  // Swallowed: the database being switched to is what somebody is waiting for,
  // and an undeleted empty file is not worth failing a sign-in over.
  await forgetDatabase(orgId).catch(() => undefined);
  return true;
}

export function openLocalStore(orgId: string): Promise<LocalStore> {
  /**
   * Memoised on the promise, not the result: two callers racing at startup
   * must not open two connections and run the migration ladder twice.
   *
   * Keyed by orgId as well, so switching farms on one device closes nothing by
   * accident and opens the right file. A cached handle for a different org
   * would be the cross-tenant bug this partitioning exists to prevent.
   */
  if (opened !== null && opened.orgId === orgId) return opened.store;

  const previous = opened;
  const store = (async () => {
    // Close the outgoing farm's connection before opening the next. Two open
    // handles on a WAL database is not a correctness problem, but leaving one
    // behind on every farm switch is a file descriptor leak on a device.
    if (previous) {
      await (await previous.store).close().catch(() => undefined);
      // And now, closed, it can go — if somebody said it should.
      await disposeIfMarked(previous.orgId);
    }

    /**
     * The device's UUID source, handed in because there is no `crypto` global
     * on React Native — see `StoreDeps`. `expo-crypto` exports the function
     * rather than installing a global, which is why this has to be wired
     * rather than polyfilled.
     */
    const next = await openSqliteStore(await openExpoSqlDriver(databaseNameFor(orgId)), {
      randomUUID: () => randomUUID(),
    });
    setLocalStore(next);
    return next;
  })();

  opened = { orgId, store };
  return store;
}

/** Tests only: drops the handle so the next call rebuilds it. */
export function resetLocalStoreHandle(): void {
  opened = null;
}
