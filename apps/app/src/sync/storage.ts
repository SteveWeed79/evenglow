import { db } from '../db/open';
import { META, parseMeta, STORES } from '../db/idb-schema';

/**
 * Storage durability (A2).
 *
 * The single highest-value thing in the offline engine, and one API call:
 * a persisted origin is not evicted under storage pressure, and Safari
 * otherwise discards non-persisted IndexedDB after roughly seven idle days.
 * A farm that logs on Monday and syncs on the following Tuesday is exactly
 * the case that loses data without this.
 */

/** Above this fraction of quota, warn before a photo capture can fail mid-write. */
const PRESSURE_THRESHOLD = 0.8;

/**
 * Which store this build is actually keeping work in.
 *
 * Everything below is a browser API and answers browser questions. On a
 * handset the answers are not merely unavailable, they are wrong: the WebView
 * reports its own origin quota while the work lives in a SQLite file in the
 * app's private sandbox, which Android does not evict for idleness. The first
 * device run showed "This device may clear unsent work if the app goes unused
 * for about a week" over a database that behaves nothing like that.
 *
 * Configured rather than detected, matching `db/store.ts` and `api.ts` — and
 * for one more reason here: importing the platform check would pull
 * @capacitor/core into the Next bundle, which compiles these same files.
 */
type Backing = 'browser' | 'device';

let backing: Backing = 'browser';

export function setStorageBacking(next: Backing): void {
  backing = next;
}

/** Exported for tests. */
export function resetStorageBacking(): void {
  backing = 'browser';
}

export interface StorageReport {
  persisted: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
  fractionUsed: number | null;
  /** True when work could be evicted, or when a large write may not fit. */
  atRisk: boolean;
  reason?: string;
}

/**
 * Requests persistence. Called on first write rather than at boot: browsers
 * weigh engagement when deciding, and asking before the user has done
 * anything is the request most likely to be refused.
 */
export async function requestPersistence(): Promise<boolean> {
  // Nothing to request: an app-private file is already as durable as this
  // device gets, and asking the WebView would grant persistence over storage
  // holding none of the work.
  if (backing === 'device') return true;

  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;

  const cached = parseMeta('persistGranted', await (await db()).get(STORES.meta, META.persistGranted));
  if (cached === true) return true;

  const granted = await navigator.storage.persist();
  await (await db()).put(STORES.meta, granted, META.persistGranted);
  return granted;
}

export async function storageReport(): Promise<StorageReport> {
  if (backing === 'device') {
    /**
     * The database is a file in the app sandbox. It survives idleness, and it
     * survives storage pressure elsewhere on the device; what removes it is
     * uninstalling the app or clearing its data, both of which are things a
     * person did on purpose.
     *
     * Usage is reported as unknown rather than guessed. The WebView's estimate
     * describes its own origin storage, which this build does not use, and a
     * confidently wrong number on the diagnostics screen is worse than no
     * number — that screen exists to be trusted when something has gone wrong.
     */
    return {
      persisted: true,
      usageBytes: null,
      quotaBytes: null,
      fractionUsed: null,
      atRisk: false,
    };
  }

  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return {
      persisted: false,
      usageBytes: null,
      quotaBytes: null,
      fractionUsed: null,
      atRisk: true,
      reason: 'This browser does not report storage limits.',
    };
  }

  const persisted = (await navigator.storage.persisted?.()) ?? false;
  const { usage, quota } = await navigator.storage.estimate();

  const usageBytes = usage ?? null;
  const quotaBytes = quota ?? null;
  const fractionUsed =
    usageBytes !== null && quotaBytes !== null && quotaBytes > 0 ? usageBytes / quotaBytes : null;

  if (fractionUsed !== null && fractionUsed >= PRESSURE_THRESHOLD) {
    return {
      persisted,
      usageBytes,
      quotaBytes,
      fractionUsed,
      atRisk: true,
      reason: 'Storage is nearly full. Sync now to free space before logging photos.',
    };
  }

  if (!persisted) {
    return {
      persisted,
      usageBytes,
      quotaBytes,
      fractionUsed,
      atRisk: true,
      reason: 'This device may clear unsent work if the app goes unused for about a week.',
    };
  }

  return { persisted, usageBytes, quotaBytes, fractionUsed, atRisk: false };
}
