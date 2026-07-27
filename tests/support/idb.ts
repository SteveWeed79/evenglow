import 'fake-indexeddb/auto';
import { closeDb, resetDbHandle } from '@steading/app/db/open';
import { DB_NAME } from '@steading/app/db/idb-schema';

/** Deletes the database and forgets the handle, so each test starts clean. */
export async function freshDb(): Promise<void> {
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    // Another connection is holding it; the test's own handle is already
    // closed, so proceeding is safe.
    request.onblocked = () => resolve();
  });
  resetDbHandle();
}

/**
 * Simulates a hard restart: the process dies without a graceful close, and
 * the next access has to reopen from whatever actually reached disk.
 */
export async function simulateRestart(): Promise<void> {
  await closeDb();
}
