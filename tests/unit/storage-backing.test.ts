import { afterEach, describe, expect, it } from 'vitest';
import {
  requestPersistence,
  resetStorageBacking,
  setStorageBacking,
  storageReport,
} from '@steading/app/sync/storage';

/**
 * What the diagnostics screen is allowed to claim on a device.
 *
 * Everything in storage.ts is a browser API answering browser questions. On a
 * handset the answers are not just unavailable, they are wrong: the WebView
 * reports its own origin quota while the work sits in a SQLite file in the
 * app's private sandbox. The first device run said "This device may clear
 * unsent work if the app goes unused for about a week" over a database that
 * does nothing of the kind — on the one screen someone opens because they are
 * already afraid their morning's work is gone.
 */

afterEach(resetStorageBacking);

describe('on a device', () => {
  it('does not warn about eviction that cannot happen', async () => {
    setStorageBacking('device');

    const report = await storageReport();

    expect(report.atRisk).toBe(false);
    expect(report.reason).toBeUndefined();
    expect(report.persisted).toBe(true);
  });

  /**
   * The WebView's estimate describes storage this build does not use. A
   * confidently wrong number on the diagnostics screen is worse than none.
   */
  it('reports usage as unknown rather than guessing', async () => {
    setStorageBacking('device');

    const report = await storageReport();

    expect(report.usageBytes).toBeNull();
    expect(report.quotaBytes).toBeNull();
    expect(report.fractionUsed).toBeNull();
  });

  it('has nothing to request, and does not go asking', async () => {
    setStorageBacking('device');

    // No navigator in this environment: a browser-path call would return
    // false here, so `true` is proof it took the device path.
    await expect(requestPersistence()).resolves.toBe(true);
  });
});

describe('in a browser', () => {
  it('is the default, so nothing has to be configured for the web build', async () => {
    const report = await storageReport();

    // No navigator.storage in a node test environment, which is the honest
    // "cannot tell" answer rather than the device one.
    expect(report.persisted).toBe(false);
    expect(report.atRisk).toBe(true);
  });
});
