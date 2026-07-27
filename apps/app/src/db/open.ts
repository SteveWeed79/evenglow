import type { SqlDriver } from './driver';
import { migrate } from './migrations/index';
import type { LocalStore } from './port';
import { SqliteStore } from './store';
import type { LocalRecord, Quarantined, QueuedMutation } from './schema';

/**
 * The one way to reach local storage.
 *
 * Components never call this — they read through hooks over the store, and the
 * store is the only thing that renders. What this file adds over `store.ts` is
 * lifecycle: open once, migrate once, hand the same instance to everyone, and
 * be safe to close and reopen.
 *
 * `useDriver` exists so the conformance suite can run the real store against
 * `node:sqlite`. It is not a seam for production code; nothing in `src/` calls
 * it.
 */

let opening: Promise<LocalStore> | null = null;
let driverFactory: (() => Promise<SqlDriver>) | null = null;

/** Swaps the driver the next open will use. Tests only. */
export function useDriver(factory: (() => Promise<SqlDriver>) | null): void {
  driverFactory = factory;
  opening = null;
}

async function defaultDriver(): Promise<SqlDriver> {
  // Imported lazily so that a test process which never opens the database does
  // not have to resolve the Capacitor plugin at all.
  const { openDriver } = await import('./client');
  return openDriver();
}

export function store(): Promise<LocalStore> {
  // Concurrent first callers share one open rather than racing two migrations.
  opening ??= (async () => {
    const driver = await (driverFactory ?? defaultDriver)();
    await migrate(driver);
    return new SqliteStore(driver);
  })().catch((error: unknown) => {
    // A failed open must not be cached as a poisoned promise — a transient
    // failure would then be permanent for the life of the process.
    opening = null;
    throw error;
  });

  return opening;
}

export async function closeDb(): Promise<void> {
  if (!opening) return;
  const current = opening;
  opening = null;
  await (await current).close();
}

/**
 * Sign-out and org switch (C5). Cached tenant data must not outlive the
 * session that fetched it, and the handle is closed afterwards so the next
 * sign-in opens a database with nothing of the previous user's in it.
 */
export async function wipeLocalData(): Promise<void> {
  await (await store()).wipe();
}

// ── Convenience re-exports ──────────────────────────────────────────────────
// The read and sync modules want one operation, not a handle. Keeping these
// here means no caller has to remember to await the singleton first.

export async function readOutboxBySeq(): Promise<QueuedMutation[]> {
  return (await store()).readOutboxBySeq();
}

export async function readRecordsByEntity(entity: string): Promise<LocalRecord[]> {
  return (await store()).readRecordsByEntity(entity);
}

export async function readAllRecords(): Promise<LocalRecord[]> {
  const current = await store();
  // Only the SQLite implementation offers a full scan; it exists for the
  // conformance suite and diagnostics, not for any screen.
  return current instanceof SqliteStore ? current.readAllRecords() : [];
}

export async function quarantineCount(): Promise<number> {
  return (await store()).quarantineCount();
}

export async function listQuarantined(): Promise<Quarantined[]> {
  return (await store()).listQuarantined();
}
