import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BrowserContext, chromium, devices, expect, type Page, test } from '@playwright/test';
import { ulid } from 'ulid';
import { executablePath } from './support/browser';
import { sessionCookie } from './support/session';

/**
 * A log that cannot be stored must say so, and must not eat the count.
 *
 * Every write path used to discard the rejection. The Tally clears its count
 * optimistically *before* awaiting the commit, so a throw left zero on screen
 * with nothing queued and nothing said: a keeper counted the basket, tapped
 * Log, watched the number go to zero, and lost it.
 *
 * ── On how the failure is produced ──────────────────────────────────────────
 *
 * The fault is injected at `IDBObjectStore.prototype.put`, which throws the
 * same `QuotaExceededError` a full device throws. Everything above that is
 * real: the enqueue transaction, the error's trip through the queue's quota
 * detection, `useLog`, and the component.
 *
 * A genuine quota was tried first and does not hold here. Chromium's
 * `Storage.overrideQuotaForOrigin` is ignored for an origin that has been
 * granted persistent storage — which this app requests on first log (A2) — and
 * denying `persistent-storage` over CDP does not restore enforcement under
 * `launchPersistentContext`: 200 MB of ballast wrote straight through a 12 MB
 * override. The persistent profile is not negotiable, since it is what makes
 * the restart gate real.
 *
 * So this proves the handling, not the browser's quota accounting. The
 * distinction matters and is worth re-checking on device, where the storage
 * layer is SQLite and a full disk fails differently (D9).
 */

const ORIGIN = 'http://127.0.0.1:3100';

const IDENTITY = {
  userId: ulid(),
  orgId: ulid(),
  role: 'owner' as const,
  email: 'full-device@example.test',
};

const { defaultBrowserType: _unused, ...PHONE } = devices['Pixel 7'];

/**
 * Arms a one-shot failure on the next IndexedDB write.
 *
 * Installed as an init script so it is in place before any app code runs, and
 * one-shot so the retry later in the test exercises the real path with no
 * lingering patch.
 */
const ARM_FAILURE = `
  window.__steadingFailNextPut = false;
  const realPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    // Only the outbox. A log writes meta and records too, and failing the
    // first put of the sequence hits the best-effort persistence request
    // instead of the queue — which proves nothing about the write path.
    if (window.__steadingFailNextPut && this.name === 'outbox') {
      window.__steadingFailNextPut = false;
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    }
    return realPut.apply(this, args);
  };
`;

async function launch(userDataDir: string): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...PHONE,
    ...(executablePath ? { executablePath } : {}),
    baseURL: ORIGIN,
  });
  await context.addCookies([await sessionCookie(IDENTITY, ORIGIN)]);
  await context.route('**/api/sync', (route) => route.abort('internetdisconnected'));
  await context.addInitScript(ARM_FAILURE);
  return context;
}

async function queuedCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('steading');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const all = await new Promise<{ entity: string }[]>((resolve, reject) => {
      const request = db.transaction('outbox').objectStore('outbox').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    db.close();
    return all.filter((m) => m.entity === 'eggLog').length;
  });
}

test('a full device keeps the count and says what happened', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'steading-full-'));
  const context = await launch(profile);

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto('/');
  await expect(page.getByTestId('tab-stock')).toBeVisible();

  await context.setOffline(true);

  // A flock to log against, written while there is still room.
  await page.getByTestId('tab-stock').click();
  await page.getByTestId('add-first-group').click();
  await page.getByTestId('addgroup-save').click();
  await page.getByTestId('tab-today').click();
  await expect(page.getByTestId('tally-commit')).toBeVisible();

  // One good log first, so the failure below is clearly the storage and not a
  // broken page: this asserts the happy path still works on this build.
  await page.getByTestId('tally-plus-1').click();
  await page.getByTestId('tally-commit').click();
  await expect(page.getByText(/in the basket/)).toBeVisible();
  expect(await queuedCount(page)).toBe(1);

  // ── Count 12 eggs into a device with no room ────────────────────────────
  await page.evaluate(() => {
    (window as unknown as { __steadingFailNextPut: boolean }).__steadingFailNextPut = true;
  });

  await page.getByTestId('tally-plus-12').click();
  await expect(page.getByTestId('tally-commit')).toContainText('12');
  await page.getByTestId('tally-commit').click();

  // The message names the problem and the action.
  const error = page.getByTestId('tally-error');
  await expect(error).toBeVisible();
  await expect(error).toContainText(/out of space/i);

  // The count is still on screen. This is the whole point: before the fix the
  // optimistic clear ran, the write threw, and 12 eggs were simply gone.
  await expect(page.getByTestId('tally-commit')).toContainText('12');

  // And nothing was queued, so the count on screen is the truth rather than a
  // second copy of something already stored.
  expect(await queuedCount(page)).toBe(1);

  // ── Room again: the same tap now works, with the count intact ───────────
  await page.getByTestId('tally-commit').click();

  await expect(page.getByText(/in the basket/)).toBeVisible();
  await expect(page.getByTestId('tally-error')).toBeHidden();
  expect(await queuedCount(page)).toBe(2);

  await context.close();
  await rm(profile, { recursive: true, force: true });
});
