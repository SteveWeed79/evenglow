import { existsSync } from 'node:fs';

const PREINSTALLED = '/opt/pw-browsers/chromium';

/**
 * Mirrors playwright.config.ts. The exit gate launches its own persistent
 * contexts rather than using the `browser` fixture, so it needs the same
 * binary resolution.
 */
export const executablePath =
  process.env.CHROMIUM_PATH ?? (existsSync(PREINSTALLED) ? PREINSTALLED : undefined);
