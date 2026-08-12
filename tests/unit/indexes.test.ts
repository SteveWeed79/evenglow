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

/**
 * One Play purchase, one farm.
 *
 * The behaviour is asserted against a database in
 * `tests/isolation/purchase-token.test.ts`. This is here as well, and pure,
 * for the reason D15 gives about the defence being structural rather than
 * remembered: *"an index is a thing somebody can forget to create."* A unique
 * index that exists only in a suite which skips without a mongod is exactly
 * that kind of thing — so the declaration is checked on every machine, and a
 * deployment cannot lose the guard by never having had a test database.
 */
describe('the purchase-token binding', () => {
  const orgIndexes = () => indexPlan().find(([name]) => name === 'orgs')?.[1] ?? [];

  it('is declared unique, so one purchase cannot entitle two farms', () => {
    const bound = orgIndexes().find((index) => 'playPurchaseToken' in index.key);

    expect(bound).toBeDefined();
    expect(bound?.unique).toBe(true);
  });

  it('is partial, so the farms with no subscription do not collide', () => {
    /**
     * The failure a plain `unique: true` would cause, and it is worse than the
     * one it fixes: almost every org has no `playPurchaseToken` and never will,
     * so a plain unique index admits exactly one of them and refuses every
     * other free farm the deployment ever creates.
     */
    const bound = orgIndexes().find((index) => 'playPurchaseToken' in index.key);

    expect(bound?.partialFilterExpression).toEqual({ playPurchaseToken: { $type: 'string' } });
  });

  it('is in the plan, so `pnpm db:indexes` applies it', () => {
    expect(indexPlan().map(([name]) => name)).toContain('orgs');
  });
});
