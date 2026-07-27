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
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;

  const cached = parseMeta('persistGranted', await (await db()).get(STORES.meta, META.persistGranted));
  if (cached === true) return true;

  const granted = await navigator.storage.persist();
  await (await db()).put(STORES.meta, granted, META.persistGranted);
  return granted;
}

export async function storageReport(): Promise<StorageReport> {
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
