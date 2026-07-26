import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BrowserContext, chromium, devices, expect, type Page, test } from '@playwright/test';
import { ulid } from 'ulid';
import { executablePath } from './support/browser';
import { sessionCookie } from './support/session';

/**
 * W2 end to end: record a treatment, see the withhold, log through it
 * deliberately.
 *
 * Runs offline throughout. A compliance warning that only works with signal is
 * absent exactly where it is needed.
 */

const ORIGIN = 'http://127.0.0.1:3100';

const IDENTITY = {
  userId: ulid(),
  orgId: ulid(),
  role: 'owner' as const,
  email: 'withdrawal@example.test',
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
  return context;
}

/** Every queued eggLog payload, so the acknowledgement can be verified. */
async function queuedEggLogs(page: Page): Promise<{ withdrawalAcknowledged?: boolean }[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('steading');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const all = await new Promise<{ entity: string; payload: unknown }[]>((resolve, reject) => {
      const request = db.transaction('outbox').objectStore('outbox').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    db.close();
    return all
      .filter((m) => m.entity === 'eggLog')
      .map((m) => m.payload as { withdrawalAcknowledged?: boolean });
  });
}

test('a withdrawal warns, and logging through it is recorded as deliberate', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'steading-w2-'));
  const context = await launch(profile);

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto('/');
  await expect(page.getByTestId('add-first-group')).toBeVisible();

  await context.setOffline(true);

  // A flock to treat.
  await page.getByTestId('add-first-group').click();
  await page.getByTestId('addgroup-save').click();
  await expect(page.getByTestId('tally-commit')).toBeVisible();

  // No treatment yet, so no band and a single-tap commit.
  await expect(page.getByText(/withheld/)).toBeHidden();
  await page.getByTestId('tally-plus-1').click();
  await page.getByTestId('tally-commit').click();
  await expect(page.getByText(/in the basket/)).toBeVisible();

  const beforeTreatment = await queuedEggLogs(page);
  expect(beforeTreatment).toHaveLength(1);
  expect(beforeTreatment[0]?.withdrawalAcknowledged).toBeUndefined();

  // ── Record a treatment with a seven-day egg withdrawal ──────────────────
  await page.getByTestId('record-treatment').click();
  await page.getByTestId('med-name').fill('Amprolium');
  await page.getByTestId('withdrawal-egg-plus-7').click();
  await page.getByTestId('med-save').click();

  // ── The band appears, naming the medication ────────────────────────────
  const band = page.getByText(/Eggs withheld/);
  await expect(band).toBeVisible();
  await expect(band).toContainText('Amprolium');

  // ── Logging through it takes a second, deliberate tap ──────────────────
  await page.getByTestId('tally-plus-1').click();
  const commit = page.getByTestId('tally-commit');

  await commit.click();
  // Armed, not committed — the wording changes and nothing is logged yet.
  await expect(commit).toContainText('anyway');
  expect(await queuedEggLogs(page)).toHaveLength(1);

  await commit.click();
  await expect(page.getByText(/in the basket/)).toBeVisible();

  // The second log carries the acknowledgement; the first, from before the
  // treatment, does not.
  const logs = await queuedEggLogs(page);
  expect(logs).toHaveLength(2);
  expect(logs.filter((l) => l.withdrawalAcknowledged === true)).toHaveLength(1);

  await context.close();
  await rm(profile, { recursive: true, force: true });
});
