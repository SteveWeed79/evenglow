import { describe, expect, it } from 'vitest';
import { INDEXES, indexPlan, leadingKey } from '@steading/api/db/indexes';
import { COLLECTIONS } from '@steading/api/db/scoped';

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

/**
 * What `applyIndexes` will actually ask Mongo for.
 *
 * Its own block because the defect it exists to prevent needed a live server
 * to find and should not have: `createIndexes([])` is not a no-op — Mongo
 * answers "Must specify at least one index to create" and the call throws.
 * `promoCodes` is declared empty on purpose (a code is found by its `_id`), so
 * a loop that passed the empty array along broke every route that opens a
 * database. Every DB-backed suite skips without a mongod, so a full local run
 * stayed green and CI found it.
 */
describe('the plan handed to Mongo', () => {
  it('never asks for an empty set of indexes', () => {
    for (const [name, indexes] of indexPlan()) {
      expect(indexes.length, `${name} would ask Mongo to create nothing`).toBeGreaterThan(0);
    }
  });

  it('still covers every tenant collection', () => {
    const planned = new Set(indexPlan().map(([name]) => name));
    for (const name of COLLECTIONS) expect(planned.has(name)).toBe(true);
  });

  /** Named rather than merely absent, so the skip cannot be mistaken for a gap. */
  it('leaves out the collections that are deliberately unindexed', () => {
    expect(indexPlan().map(([name]) => name)).not.toContain('promoCodes');
  });
});
