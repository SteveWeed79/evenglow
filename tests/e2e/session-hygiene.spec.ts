import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BrowserContext, chromium, devices, expect, type Page, test } from '@playwright/test';
import { ulid } from 'ulid';
import { executablePath } from './support/browser';
import { sessionCookie } from './support/session';

/**
 * C5 — client-side residue.
 *
 * The local wipe IS the tenant-isolation control on a shared device. Server
 * scoping does nothing about the previous farm's records still sitting in this
 * browser's IndexedDB, so this is verified in a real browser rather than only
 * against a fake.
 */

const ORIGIN = 'http://127.0.0.1:3100';

const IDENTITY = {
  userId: ulid(),
  orgId: ulid(),
  role: 'owner' as const,
  email: 'hygiene@example.test',
};

const { defaultBrowserType: _unused, ...PHONE } = devices['Pixel 7'];

async function launch(userDataDir: string): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...PHONE,
    ...(executablePath ? { executablePath } : {}),
    baseURL: ORIGIN,
  });
  await context.addCookies([await sessionCookie(IDENTITY, ORIGIN)]);
  await context.route('**/api/sync', (route) => route.abort('internetdisconnected'));
  await context.route('**/api/pull*', (route) => route.abort('internetdisconnected'));
  return context;
}

/** Counts rows across every local store. */
async function localRowCount(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async () => {
    const names = ['outbox', 'records', 'meta', 'quarantine'];
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('steading');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const counts: Record<string, number> = {};
    for (const name of names) {
      if (!db.objectStoreNames.contains(name)) {
        counts[name] = 0;
        continue;
      }
      counts[name] = await new Promise<number>((resolve, reject) => {
        const request = db.transaction(name).objectStore(name).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    db.close();
    return counts;
  });
}

test('signing out clears every local store', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'steading-hygiene-'));
  const context = await launch(profile);

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto('/');
  await expect(page.getByTestId('add-first-group')).toBeVisible();

  await context.setOffline(true);

  // Record something worth protecting.
  await page.getByTestId('add-first-group').click();
  await page.getByTestId('addgroup-save').click();
  await expect(page.getByTestId('tally-commit')).toBeVisible();
  await page.getByTestId('tally-plus-1').click();
  await page.getByTestId('tally-commit').click();
  await expect(page.getByText(/in the basket/)).toBeVisible();

  const before = await localRowCount(page);
  expect(before.outbox).toBeGreaterThan(0);
  expect(before.records).toBeGreaterThan(0);
  expect(before.meta).toBeGreaterThan(0);

  // ── Sign out ─────────────────────────────────────────────────────────────
  // Back online: ending the server session needs the network. The offline
  // case is covered separately below.
  await context.setOffline(false);
  await page.getByTestId('sign-out').click();

  // Unsent work is destroyed by the wipe, so the user is told first.
  await expect(page.getByText(/have not reached the server/)).toBeVisible();

  await page.getByTestId('sign-out-confirm').click();
  await page.waitForURL(/\/sign-in/, { timeout: 30_000 });

  // ── Nothing of the previous session survives ─────────────────────────────
  const after = await localRowCount(page);
  expect(after.outbox).toBe(0);
  expect(after.records).toBe(0);
  expect(after.meta).toBe(0);
  expect(after.quarantine).toBe(0);

  await context.close();
  await rm(profile, { recursive: true, force: true });
});


test('signing out offline still clears the device, and says so', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'steading-hygiene-off-'));
  const context = await launch(profile);

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto('/');
  await expect(page.getByTestId('add-first-group')).toBeVisible();

  await context.setOffline(true);
  await page.getByTestId('add-first-group').click();
  await page.getByTestId('addgroup-save').click();
  await expect(page.getByTestId('tally-commit')).toBeVisible();

  await page.getByTestId('sign-out').click();
  await page.getByTestId('sign-out-confirm').click();

  // The device is the thing this control protects, and it is cleaned even
  // though the server session cannot be ended yet.
  await expect(page.getByTestId('sign-out-offline')).toBeVisible();

  const after = await localRowCount(page);
  expect(after.outbox).toBe(0);
  expect(after.records).toBe(0);
  expect(after.meta).toBe(0);

  await context.close();
  await rm(profile, { recursive: true, force: true });
});
