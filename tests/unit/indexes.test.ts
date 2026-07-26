import { describe, expect, it } from 'vitest';
import { INDEXES, leadingKey } from '@/server/db/indexes';
import { COLLECTIONS } from '@/server/db/scoped';

/**
 * C3 — index discipline. Asserted against the definitions rather than a live
 * server so a missing index fails the build on any machine, including one
 * without a mongod.
 */
describe('index discipline', () => {
  it('defines indexes for every collection, and no others', () => {
    expect(Object.keys(INDEXES).sort()).toEqual([...COLLECTIONS].sort());
  });

  it.each([...COLLECTIONS])('%s has at least one index', (name) => {
    expect(INDEXES[name].length).toBeGreaterThan(0);
  });

  it.each([...COLLECTIONS])('every %s index leads with orgId', (name) => {
    for (const index of INDEXES[name]) {
      expect(leadingKey(index)).toBe('orgId');
    }
  });
});
