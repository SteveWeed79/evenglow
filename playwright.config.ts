import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Phase 2 exit gate runs against a production build in a real browser.
 *
 * IndexedDB durability, Service Worker behaviour, and restart survival cannot
 * be established with a fake — fake-indexeddb proves the logic, this proves
 * the platform.
 */
const PORT = 3100;

/**
 * Use whatever Chromium the environment already has rather than downloading
 * one. Playwright's own resolution requires the browser build to match the
 * @playwright/test version exactly, which is not true of preinstalled images,
 * so an existing binary wins when there is one.
 */
const PREINSTALLED = '/opt/pw-browsers/chromium';
const executablePath =
  process.env.CHROMIUM_PATH ?? (existsSync(PREINSTALLED) ? PREINSTALLED : undefined);

const browserBinary = executablePath ? { launchOptions: { executablePath } } : {};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Pixel 7'], // a mid-tier Android viewport, per the rubric
        ...browserBinary,
      },
    },
  ],

  webServer: {
    command: `pnpm start --port ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      // The gate stubs /api/sync, so no database is involved. AUTH_SECRET has
      // to match the one the test signs its session cookie with.
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'phase-2-exit-gate-secret-value',
      MONGODB_URI: 'mongodb://127.0.0.1:27017',
      MONGODB_DB: 'steading',
      AUTH_TRUST_HOST: 'true',
    },
  },
});
