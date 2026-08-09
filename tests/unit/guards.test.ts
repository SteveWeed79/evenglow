import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { readEnv } from '@steading/api/env';

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
  ['the contracts package', 'packages/contracts/src/probe.ts'],
  ['the shared core', 'packages/core/src/sync/probe.ts'],
  ['the Fastify API', 'apps/api/src/routes/probe.ts'],
  ['the React Native client', 'apps/mobile/src/screens/probe.ts'],
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
    ['today', 'apps/api/src/db/scoped.ts'],
    ['after the migration (S3)', 'apps/api/src/db/scoped.ts'],
  ])('exempts the scoped data layer %s', async (_label, path) => {
    expect(await rulesFiredIn(path, TENANCY_VIOLATION)).not.toContain('no-restricted-syntax');
  });
});

describe('client storage guard (D9, invariant 6)', () => {
  it.each([
    ['localStorage', STORAGE_VIOLATION],
    ['indexedDB', INDEXEDDB_VIOLATION],
  ])('bans %s in the React Native client', async (_label, code) => {
    expect(await rulesFiredIn('apps/mobile/src/screens/probe.ts', code)).toContain(
      'no-restricted-globals',
    );
  });

  /**
   * And explicitly NOT in the current client, which is built on IndexedDB
   * knowingly until S4 ports it (masterplan §0.1). A ban that fires here would
   * read as an instruction to delete the only engine that has passed the
   * Phase 2 exit gate.
   */
  /**
   * The exemption is gone, and that is the assertion.
   *
   * `apps/app/src/db/**` used to be exempt because the IndexedDB engine lived
   * there knowingly through the migration. The web client is retired, so there
   * is no longer any directory in this repo where browser storage is allowed —
   * which is what S7 was for. Asserted here rather than assumed, because an
   * exemption that outlives its reason is invisible until something uses it.
   */
  it('leaves no exemption behind in the storage layer itself', async () => {
    expect(await rulesFiredIn('packages/core/src/db/probe.ts', INDEXEDDB_VIOLATION)).toContain(
      'no-restricted-globals',
    );
  });
});

describe('shared code guard', () => {
  it.each([
    ['the contracts package', 'packages/contracts/src/probe.ts'],
    ['the React Native client (S5)', 'apps/mobile/src/screens/probe.ts'],
  ])('keeps the Mongo driver out of %s', async (_label, path) => {
    // Not just MongoClient here: shared code may not import the driver at all,
    // because this bundle ships inside an APK and is trivially unpacked.
    const fired = await rulesFiredIn(path, `import { ObjectId } from 'mongodb';\nexport const x = ObjectId;\n`);
    expect(fired).toContain('no-restricted-imports');
  });
});

/**
 * The port is the only way to the local store.
 *
 * `db/open.ts` is the IndexedDB implementation. Importing it directly works
 * perfectly in a browser, because there the port resolves to the same
 * database — so the mistake survives every test and every dev-server session
 * and only appears on a handset.
 *
 * It appeared on the first one. Every read module imported
 * `readRecordsByEntity` from there, so a group added on device was written to
 * SQLite and looked for in an IndexedDB that had never been touched: adding
 * stock did nothing at all, and said nothing. Sign-out was worse — it wiped
 * the browser store and left the previous farm's records on a shared tablet
 * (C5).
 */
/**
 * Reaching past `localStore()` to an implementation by name.
 *
 * This is the shape of the migration's worst bug: every read module imported
 * the store implementation directly, so a group added on device was written to
 * one database and looked for in another. It survived every test because in a
 * browser both paths resolved to the same place.
 */
const PORT_BYPASS =
  "import { openSqliteStore } from '../db/sqlite-store';\nexport const x = openSqliteStore;\n";

describe('local store port guard', () => {
  it('blocks reaching past the port in the React Native client', async () => {
    expect(await rulesFiredIn('apps/mobile/src/read/probe.ts', PORT_BYPASS)).toContain(
      'no-restricted-imports',
    );
  });

  /**
   * The storage layer itself is exempt, and has to be: db/store.ts chooses
   * between the two implementations, so it imports one by name.
   */
  it('exempts the storage layer, which is what does the choosing', async () => {
    expect(await rulesFiredIn('apps/mobile/src/db/probe.ts', PORT_BYPASS)).not.toContain(
      'no-restricted-imports',
    );
  });
});

/**
 * The globals Node has and Hermes does not.
 *
 * **This is the guard that cost two days.** `crypto.randomUUID()` sat in
 * `enqueue`, passed a thousand tests, and meant nothing could be saved on a
 * handset — because the tests run in Node and the app runs in Hermes, and Node
 * is the more generous of the two.
 *
 * The roadmap planned a vitest project that reshaped `globalThis` to what the
 * device provides. A lint rule is better and this is why: it fires on the
 * *reference*, so it does not depend on a test happening to exercise the line.
 * `crypto.randomUUID` was on a path four suites touched, and not one of them
 * ran it against a missing global.
 *
 * Every case below is a real defect this project shipped, or the next one of
 * the same family.
 */
describe('device parity — what Hermes does not have', () => {
  it.each([
    ['crypto', 'export const id = (): string => crypto.randomUUID();'],
    ['Buffer', "export const b = (s: string): unknown => Buffer.from(s, 'base64');"],
    ['TextEncoder', 'export const e = (s: string): unknown => new TextEncoder().encode(s);'],
    ['TextDecoder', 'export const d = (b: Uint8Array): string => new TextDecoder().decode(b);'],
    ['structuredClone', 'export const c = (v: object): object => structuredClone(v);'],
    ['atob', "export const a = (s: string): string => atob(s);"],
  ])('bans %s in the shared core', async (_label, code) => {
    expect(await rulesFiredIn('packages/core/src/sync/probe.ts', code)).toContain(
      'no-restricted-globals',
    );
  });

  it('bans crypto in the client too, which is where it actually shipped', async () => {
    expect(
      await rulesFiredIn(
        'apps/mobile/src/db/probe.ts',
        'export const id = (): string => crypto.randomUUID();',
      ),
    ).toContain('no-restricted-globals');
  });

  /**
   * `window` and `navigator` EXIST on a handset, and that is the trap.
   *
   * React Native defines `window` as an alias for the global, so
   * `typeof window !== 'undefined'` passes — and the next line calls an
   * `addEventListener` that is not there. That is the
   * `TypeError: undefined is not a function` that stopped the app booting, and
   * no globals ban could have caught it because the global is present.
   */
  it.each([
    ['window.addEventListener', "export const w = (): void => window.addEventListener('online', () => {});"],
    ['navigator.onLine', 'export const n = (): boolean => navigator.onLine;'],
  ])('bans %s, which exists on device and does not work', async (_label, code) => {
    expect(await rulesFiredIn('packages/core/src/sync/probe.ts', code)).toContain(
      'no-restricted-syntax',
    );
  });

  /**
   * The regression this file caught the moment the rule above was added.
   *
   * `no-restricted-syntax` REPLACES its options when a later config block sets
   * it again — it does not merge. Naming only the new selectors silently
   * disarmed the tenancy ones for every file in core and the client, and
   * nothing but this test would have said so.
   */
  it('still bans raw collection access where the new selectors were added', async () => {
    const fired = await rulesFiredIn(
      'packages/core/src/sync/probe.ts',
      "export const c = (db: { collection: (n: string) => unknown }): unknown => db.collection('x');",
    );
    expect(fired).toContain('no-restricted-syntax');
  });

  /** Node and the server are not the constrained runtime, and are left alone. */
  it('leaves the Fastify API free to use Node globals', async () => {
    expect(
      await rulesFiredIn(
        'apps/api/src/routes/probe.ts',
        "export const b = (s: string): unknown => Buffer.from(s, 'base64');",
      ),
    ).not.toContain('no-restricted-globals');
  });
});

/**
 * Who the server is willing to believe about where a request came from.
 *
 * `request.ip` is what every rate limiter in the service keys on, and
 * `trustProxy: true` makes it a value the caller chooses. The auth limiter is
 * the thing standing between a password and an unlimited number of guesses, so
 * a forgeable key there is invariant 10 — authorization failing open.
 */
describe('proxy trust (invariant 10)', () => {
  const base = {
    AUTH_SECRET: 'a-test-secret-long-enough-for-hs256-abcdef',
    MONGODB_URI: 'mongodb://localhost:27017',
  };

  it('trusts nothing unless a deployment says otherwise', () => {
    // The default has to be the failing-closed one: a server reachable
    // directly must not take an address from a header.
    expect(readEnv(base).TRUSTED_PROXY_HOPS).toBe(0);
  });

  it('takes the number of proxies the deployment actually runs', () => {
    expect(readEnv({ ...base, TRUSTED_PROXY_HOPS: '1' }).TRUSTED_PROXY_HOPS).toBe(1);
    expect(readEnv({ ...base, TRUSTED_PROXY_HOPS: '2' }).TRUSTED_PROXY_HOPS).toBe(2);
  });

  it('refuses a value that is not a count, at startup rather than at a request', () => {
    // `true` is the tempting wrong answer, and it is exactly the old behaviour.
    expect(() => readEnv({ ...base, TRUSTED_PROXY_HOPS: 'true' })).toThrow(/whole number/);
    expect(() => readEnv({ ...base, TRUSTED_PROXY_HOPS: '-1' })).toThrow(/whole number/);
  });

  it('hands Fastify false rather than 0 when nothing is trusted', async () => {
    // `trustProxy: 0` is not the same as `false` to Fastify, and passing the
    // number straight through would be a quiet behaviour change.
    const source = await readFile(
      fileURLToPath(new URL('../../apps/api/src/server.ts', import.meta.url)),
      'utf8',
    );
    expect(source).toContain('env.TRUSTED_PROXY_HOPS > 0 ? env.TRUSTED_PROXY_HOPS : false');
    expect(source).not.toMatch(/trustProxy:\s*true/);
  });
});
