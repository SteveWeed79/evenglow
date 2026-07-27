import { Capacitor } from '@capacitor/core';

/**
 * How safe local data is from being reclaimed.
 *
 * On a device this is a short answer: an app's SQLite file lives in its private
 * data directory and the OS does not evict it. Only the user uninstalling or
 * clearing app data removes it. So `persisted` is simply true, and saying so is
 * more honest than leaving the diagnostics sheet showing "No" forever because
 * a browser API is missing.
 *
 * In the browser dev loop the answer is the browser's, and it is worth asking:
 * the whole point of the loop is to behave like the device, and an evicted
 * origin behaves nothing like one.
 */

export interface StorageReport {
  /** True when the OS will not reclaim this data without the user asking. */
  persisted: boolean;
  /** Bytes in use, where the platform will say. */
  usageBytes: number | null;
  /** Bytes available, where the platform will say. */
  quotaBytes: number | null;
  /** True when unsent work could be reclaimed without the user doing anything. */
  atRisk: boolean;
  /** Plain-language explanation, shown in diagnostics when `atRisk`. */
  reason: string | null;
}

/** Below this much headroom, a long offline stretch can run the device dry. */
const LOW_HEADROOM_BYTES = 10 * 1024 * 1024;

interface StorageManagerLike {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
}

function storageManager(): StorageManagerLike | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { storage?: StorageManagerLike }).storage ?? null;
}

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export async function storageReport(): Promise<StorageReport> {
  if (isNative()) {
    // No estimate API on the native side. Reporting null beats reporting a
    // made-up number in the one screen a farmer opens when something is wrong.
    return { persisted: true, usageBytes: null, quotaBytes: null, atRisk: false, reason: null };
  }

  const manager = storageManager();
  if (!manager) {
    return {
      persisted: false,
      usageBytes: null,
      quotaBytes: null,
      atRisk: true,
      reason: 'This browser will not say whether it can clear stored work. Sync often.',
    };
  }

  const persisted = (await manager.persisted?.()) ?? false;
  const estimate = (await manager.estimate?.()) ?? {};
  const usageBytes = estimate.usage ?? null;
  const quotaBytes = estimate.quota ?? null;

  const headroom = usageBytes !== null && quotaBytes !== null ? quotaBytes - usageBytes : null;

  // Two separate risks, and the more urgent one wins: no room left beats no
  // guarantee against eviction, because the first stops logging today.
  const reason =
    headroom !== null && headroom < LOW_HEADROOM_BYTES
      ? 'This device is nearly out of room for stored work. Sync to free space.'
      : persisted
        ? null
        : 'The browser has not guaranteed this data against clearing. Sync often.';

  return { persisted, usageBytes, quotaBytes, atRisk: reason !== null, reason };
}

/**
 * Asks the browser not to evict this origin. A no-op on device, where the
 * question does not arise.
 *
 * Fire-and-forget by design: a refusal changes nothing the app can do about
 * it, and blocking a log path on a permission prompt would break R6.
 */
export async function requestPersistence(): Promise<boolean> {
  if (isNative()) return true;

  const manager = storageManager();
  if (!manager?.persist) return false;

  try {
    return await manager.persist();
  } catch {
    return false;
  }
}
