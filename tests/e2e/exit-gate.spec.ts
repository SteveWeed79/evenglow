import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BrowserContext, chromium, devices, expect, type Page, test } from '@playwright/test';
import { ulid } from 'ulid';
import { executablePath } from './support/browser';
import { sessionCookie } from './support/session';

/**
 * PHASE 2 EXIT GATE
 *
 *   airplane mode → 50 mutations → hard device restart → reconnect
 *   → zero loss, zero duplicates
 *
 * Nothing downstream of Phase 2 may be built until this passes.
 *
 * Note the persistent profile on disk. A fresh BrowserContext carries cookies
 * and localStorage but NOT IndexedDB, so restarting into one would be testing
 * an empty database — the queue has to survive in a real on-disk profile for
 * this to mean anything.
 */

const ORIGIN = 'http://127.0.0.1:3100';
const EGG_LOGS = 50;
/** The 50 egg logs plus the group they are logged against. */
const TOTAL_MUTATIONS = EGG_LOGS + 1;

const IDENTITY = {
  userId: ulid(),
  orgId: ulid(),
  role: 'owner' as const,
  email: 'gate@example.test',
};

// `defaultBrowserType` is a fixture hint, not a launch option.
const { defaultBrowserType: _unused, ...PHONE } = devices['Pixel 7'];

interface ServerLog {
  /** Every mutation id the server was asked to apply, across restarts. */
  seen: string[];
  batches: number[][];
}

async function launch(userDataDir: string): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...PHONE,
    ...(executablePath ? { executablePath } : {}),
    baseURL: ORIGIN,
  });
  await context.addCookies([await sessionCookie(IDENTITY, ORIGIN)]);
  return context;
}

/** Records what reached the server, and answers as the real route would. */
async function serveSync(context: BrowserContext, log: ServerLog): Promise<void> {
  await context.route('**/api/sync', async (route) => {
    const body = route.request().postDataJSON() as {
      mutations: { id: string; clientSeq: number }[];
    };

    log.seen.push(...body.mutations.map((m) => m.id));
    log.batches.push(body.mutations.map((m) => m.clientSeq));

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: body.mutations.map((m) => ({ id: m.id, status: 'applied' })),
        serverTs: Date.now(),
      }),
    });
  });
}

/** Records any attempt that escapes while offline, then fails it. */
async function blockSync(context: BrowserContext, log: ServerLog): Promise<void> {
  await context.route('**/api/sync', async (route) => {
    const body = route.request().postDataJSON() as { mutations: { id: string }[] } | null;
    if (body) log.seen.push(...body.mutations.map((m) => m.id));
    await route.abort('internetdisconnected');
  });
}

async function readQueue(page: Page): Promise<{ outbox: number; enqueued: number }> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('steading');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const count = await new Promise<number>((resolve, reject) => {
      const request = db.transaction('outbox').objectStore('outbox').count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const enqueued = await new Promise<number>((resolve, reject) => {
      const request = db.transaction('meta').objectStore('meta').get('nextClientSeq');
      request.onsuccess = () => resolve(Number(request.result ?? 0));
      request.onerror = () => reject(request.error);
    });

    db.close();
    return { outbox: count, enqueued };
  });
}

async function logOneEgg(page: Page): Promise<void> {
  await page.getByTestId('tally-plus-1').click();
  await page.getByTestId('tally-commit').click();
}

/**
 * Creates a group so there is something to log against. Done offline in the
 * gate, deliberately: it puts a mutable entity in the restart set alongside
 * the append-only ones, so both projection paths are exercised.
 */
async function addGroup(page: Page): Promise<void> {
  await page.getByTestId('add-first-group').click();
  await page.getByTestId('addgroup-save').click();
  await expect(page.getByTestId('tally-commit')).toBeVisible();
}

test('50 mutations survive airplane mode and a hard restart, then sync exactly once', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'steading-gate-'));
  const log: ServerLog = { seen: [], batches: [] };

  // ── Load the app, then lose signal ───────────────────────────────────────
  let context = await launch(profile);
  await blockSync(context, log);

  let page = context.pages()[0] ?? (await context.newPage());
  await page.goto('/');
  await expect(page.getByTestId('add-first-group')).toBeVisible();

  await context.setOffline(true);

  // Both the group and its egg logs are created with no signal.
  await addGroup(page);
  for (let i = 0; i < EGG_LOGS; i++) {
    await logOneEgg(page);
  }

  const beforeRestart = await readQueue(page);
  expect(beforeRestart.enqueued).toBe(TOTAL_MUTATIONS);
  expect(beforeRestart.outbox).toBe(TOTAL_MUTATIONS);
  expect(log.seen).toHaveLength(0);

  // ── Hard restart ─────────────────────────────────────────────────────────
  // Closing the persistent context kills the browser process. Whatever is in
  // the profile on disk is all that survives.
  await context.close();

  context = await launch(profile);
  await serveSync(context, log);

  page = context.pages()[0] ?? (await context.newPage());
  await page.goto('/');

  // The queue must still be there before anything drains it.
  expect((await readQueue(page)).outbox).toBe(TOTAL_MUTATIONS);

  // ── Reconnect ────────────────────────────────────────────────────────────
  await expect.poll(async () => (await readQueue(page)).outbox, { timeout: 60_000 }).toBe(0);

  const afterSync = await readQueue(page);

  // Zero loss.
  expect(new Set(log.seen).size).toBe(TOTAL_MUTATIONS);
  // Zero duplicates.
  expect(log.seen).toHaveLength(TOTAL_MUTATIONS);
  // No sequence number was reused across the restart.
  expect(afterSync.enqueued).toBe(TOTAL_MUTATIONS);

  // Ordering held within each batch, and across them (A4).
  for (const batch of log.batches) {
    expect(batch).toEqual([...batch].sort((a, b) => a - b));
  }
  const flattened = log.batches.flat();
  expect(flattened).toEqual([...flattened].sort((a, b) => a - b));

  await context.close();
  await rm(profile, { recursive: true, force: true });
});

test('a log never waits on the network', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'steading-nowait-'));
  const log: ServerLog = { seen: [], batches: [] };

  const context = await launch(profile);
  await blockSync(context, log);

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto('/');
  await expect(page.getByTestId('add-first-group')).toBeVisible();

  await context.setOffline(true);
  await addGroup(page);

  const started = Date.now();
  await logOneEgg(page);
  // Rendered from local state, so this measures the durable write rather than
  // a request (R6).
  await expect(page.getByText(/in the basket/)).toBeVisible();
  const elapsed = Date.now() - started;

  expect(elapsed).toBeLessThan(2_000);
  expect(log.seen).toHaveLength(0);

  await context.close();
  await rm(profile, { recursive: true, force: true });
});
