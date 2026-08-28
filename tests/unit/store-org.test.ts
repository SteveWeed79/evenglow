import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLocalStore, storeOrgId } from '@homefarm/core/db/store';
import { nodeSqlDriver } from '../support/sqlite';

/**
 * The store says which farm it holds, and `openLocalStore` is what says so.
 *
 * The other half of the wiring `tests/unit/token-org.test.ts` covers. The
 * fence in `core/sync/tenant.ts` compares two values; either one going missing
 * turns it off silently, because a null means *unknown* and never blocks. This
 * is the store's half.
 *
 * The native module is the only thing stubbed: `db/open.ts` is the sole file
 * allowed to name `expo-sqlite`, and it throws in Node by design. The store
 * underneath is the real one, on a real SQLite file, exactly as every other
 * offline suite runs it.
 */

const opened: string[] = [];

vi.mock('../../apps/mobile/src/db/open', () => ({
  databaseNameFor: (orgId: string) => `homefarm-${orgId}.db`,
  forgetDatabase: async () => undefined,
  openExpoSqlDriver: async (name: string) => {
    opened.push(name);
    return nodeSqlDriver();
  },
}));

const ORG = '01J000000000000000000ORG1';
const OTHER = '01J000000000000000000ORG2';

beforeEach(async () => {
  opened.length = 0;
  resetLocalStore();
  const { resetLocalStoreHandle } = await import('../../apps/mobile/src/db/store');
  resetLocalStoreHandle();
});

afterEach(() => {
  resetLocalStore();
});

describe('opening a farm', () => {
  it('installs the store under the farm it holds', async () => {
    const { openLocalStore } = await import('../../apps/mobile/src/db/store');

    await openLocalStore(ORG);

    expect(opened).toEqual([`homefarm-${ORG}.db`]);
    expect(storeOrgId()).toBe(ORG);
  });

  /**
   * The switch itself. Until the new file is open the token may already be the
   * next farm's, which is the window H2 is about — so what matters is that the
   * name moves at the same instant the store does, and never before it.
   */
  it('renames as the database changes, and only then', async () => {
    const { openLocalStore } = await import('../../apps/mobile/src/db/store');

    await openLocalStore(ORG);
    expect(storeOrgId()).toBe(ORG);

    await openLocalStore(OTHER);
    expect(storeOrgId()).toBe(OTHER);
    expect(opened).toEqual([`homefarm-${ORG}.db`, `homefarm-${OTHER}.db`]);
  });

  it('leaves nothing named once the store is dropped', async () => {
    const { openLocalStore } = await import('../../apps/mobile/src/db/store');

    await openLocalStore(ORG);
    resetLocalStore();

    expect(storeOrgId()).toBeNull();
  });
});
