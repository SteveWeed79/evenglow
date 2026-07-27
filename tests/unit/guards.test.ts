import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * The guards are asserted, not assumed.
 *
 * Rubric C1 says tenancy scoping is lint- and CI-enforced. That claim held
 * right up until a restructure moved src/ and left every check pointed at the
 * old path — at which point the rules covered nothing, reported success, and
 * CI could not tell anyone, because it died at install first.
 *
 * The failure was invisible because "the config lists this directory" is a
 * convention, and conventions do not survive a tree move. So coverage is
 * checked by running ESLint against a deliberate violation and requiring the
 * rule to fire.
 *
 * ESLint resolves configuration from a file's PATH, not its existence, so
 * directories the migration has not created yet can be covered here too. That
 * is the point: the guard for apps/api is proven before apps/api exists,
 * instead of being remembered afterwards.
 */

const cwd = fileURLToPath(new URL('../..', import.meta.url));
const eslint = new ESLint({ cwd });

const TENANCY_VIOLATION = `
import { MongoClient } from 'mongodb';
export function probe(client: MongoClient): unknown {
  return client.db().collection('mutations');
}
`;

const STORAGE_VIOLATION = `
export function probe(): string | null {
  return localStorage.getItem('token');
}
`;

const INDEXEDDB_VIOLATION = `
export function probe(): IDBOpenDBRequest {
  return indexedDB.open('steading');
}
`;

async function rulesFiredIn(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false });
  return (result?.messages ?? [])
    .map((m) => m.ruleId)
    .filter((id): id is string => id !== null);
}

/** Source roots the tenancy guard must cover — current, and post-migration. */
const GUARDED = [
  ['server code today', 'src/server/sync/probe.ts'],
  ['client code today', 'src/client/sync/probe.ts'],
  ['the contracts package', 'packages/contracts/src/probe.ts'],
  ['the Fastify API (S3)', 'apps/api/src/routes/probe.ts'],
  ['the Capacitor client (S5)', 'apps/app/src/screens/probe.ts'],
] as const;

describe('tenancy guard (D2, rubric C1)', () => {
  it.each(GUARDED)('covers %s', async (_label, path) => {
    const fired = await rulesFiredIn(path, TENANCY_VIOLATION);

    // Raw collection access, wherever it is written.
    expect(fired).toContain('no-restricted-syntax');
    // And the driver import that would make it possible.
    expect(fired).toContain('no-restricted-imports');
  });

  /**
   * The db layer is the one place allowed to hold a collection handle. If this
   * stopped being exempt the guard would be unusable and someone would reach
   * for an eslint-disable, which check-no-db-disables then fails on — so the
   * exemption is part of the mechanism, not a hole in it.
   */
  it.each([
    ['today', 'src/server/db/scoped.ts'],
    ['after the migration (S3)', 'apps/api/src/db/scoped.ts'],
  ])('exempts the scoped data layer %s', async (_label, path) => {
    expect(await rulesFiredIn(path, TENANCY_VIOLATION)).not.toContain('no-restricted-syntax');
  });
});

describe('client storage guard (D9, invariant 6)', () => {
  it.each([
    ['localStorage', STORAGE_VIOLATION],
    ['indexedDB', INDEXEDDB_VIOLATION],
  ])('bans %s in the Capacitor client', async (_label, code) => {
    expect(await rulesFiredIn('apps/app/src/screens/probe.ts', code)).toContain(
      'no-restricted-globals',
    );
  });

  /**
   * And explicitly NOT in the current client, which is built on IndexedDB
   * knowingly until S4 ports it (masterplan §0.1). A ban that fires here would
   * read as an instruction to delete the only engine that has passed the
   * Phase 2 exit gate.
   */
  it('does not fire on the pre-migration client', async () => {
    expect(await rulesFiredIn('src/client/db/open.ts', INDEXEDDB_VIOLATION)).not.toContain(
      'no-restricted-globals',
    );
  });
});

describe('shared code guard', () => {
  it.each([
    ['the contracts package', 'packages/contracts/src/probe.ts'],
    ['the Capacitor client (S5)', 'apps/app/src/screens/probe.ts'],
  ])('keeps the Mongo driver out of %s', async (_label, path) => {
    // Not just MongoClient here: shared code may not import the driver at all,
    // because this bundle ships inside an APK and is trivially unpacked.
    const fired = await rulesFiredIn(path, `import { ObjectId } from 'mongodb';\nexport const x = ObjectId;\n`);
    expect(fired).toContain('no-restricted-imports');
  });
});
