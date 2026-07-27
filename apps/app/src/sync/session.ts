import { localStore } from '../db/store';
import { stopSync } from './engine';

/**
 * Session hygiene (C5).
 *
 * Every local store is cleared on sign-out and on org switch. Cached tenant
 * data must not outlive the session that fetched it — a shared barn tablet
 * where the next person to sign in can read the previous farm's records is a
 * tenant-isolation failure, however good the server-side scoping is.
 *
 * The queue is wiped along with everything else. That is deliberate and is
 * why the caller must warn first: unsent work belongs to the session that
 * created it, and carrying it into the next sign-in would attribute one
 * person's records to another.
 */
export async function clearSession(): Promise<void> {
  stopSync();
  await localStore().wipe();
  // Reopen from scratch next time, so no handle outlives the wipe.
  await localStore().close();
}
