import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * No two suites may share a database name (B-3).
 *
 * Under `MONGODB_TEST_URI` — which is how CI runs — every file connects to one
 * shared mongod and picks a database by *name*, so the per-file harness
 * isolates the client and not the data. These suites wipe collections in
 * `beforeEach`, so two files on one name wipe each other's fixtures mid-test.
 * Five shared `homefarm_isolation` for a long time, and `fileParallelism: false`
 * was quietly holding it together.
 *
 * A test rather than a convention, because the failure it prevents is invisible
 * in the ordinary case: it needs a shared server *and* concurrency, so it is
 * green locally, green in CI today, and waits for the day somebody turns file
 * parallelism back on.
 *
 * Reads the sources rather than importing them: importing a database-backed
 * suite runs it.
 */

const TESTS = fileURLToPath(new URL('..', import.meta.url));

/** The name a caller gets by not choosing one — and the production one. */
const DEFAULT_DB_NAME = 'homefarm';

function testFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...testFiles(path));
    else if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) found.push(path);
  }
  return found;
}

function namesIn(source: string): string[] {
  return [...source.matchAll(/startTestDb\(\s*'([^']*)'\s*\)/g)].map((m) => m[1] ?? '');
}

describe('the database names the suites ask for', () => {
  const claimed = new Map<string, string[]>();

  for (const file of testFiles(TESTS)) {
    for (const name of namesIn(readFileSync(file, 'utf8'))) {
      claimed.set(name, [...(claimed.get(name) ?? []), file.slice(TESTS.length)]);
    }
  }

  it('finds the call sites at all, so this cannot pass by matching nothing', () => {
    expect(claimed.size).toBeGreaterThan(5);
  });

  it('gives every suite one of its own', () => {
    const shared = [...claimed.entries()].filter(([, files]) => files.length > 1);

    expect(
      shared.map(([name, files]) => `${name}: ${files.join(', ')}`),
      'these suites share a database and will wipe each other under a shared MONGODB_TEST_URI',
    ).toEqual([]);
  });

  /**
   * `startTestDb()` with no argument means `homefarm` — the production name.
   * The harness drops its database on `stop()`, and refuses to drop that one
   * for exactly this reason; a suite naming it explicitly would be asking for
   * the guard to save it.
   */
  it('never asks for the production name', () => {
    expect([...claimed.keys()]).not.toContain(DEFAULT_DB_NAME);
  });
});
