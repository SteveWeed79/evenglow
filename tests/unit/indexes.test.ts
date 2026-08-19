import { describe, expect, it } from 'vitest';
import { INDEXES, indexPlan, leadingKey } from '@homefarm/api/db/indexes';
import { COLLECTIONS } from '@homefarm/api/db/scoped';
import { PENDING } from '@homefarm/api/sync/outcome';

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

/**
 * The other way a person is identified.
 *
 * Same argument as the purchase-token block above, and the same reason for
 * being here rather than only in a database-backed suite: an index that exists
 * only in a test which skips without a mongod is exactly the thing D15 warns
 * about, *"a thing somebody can forget to create"*.
 *
 * `findUserByGoogleSub` is the first query every Google sign-in makes and had
 * no index at all — a collection scan on the hot path of one of two ways into
 * the app. Uniqueness is the half that matters more: `linkGoogleSub` binds a
 * subject to an existing account with nothing stopping the same subject being
 * bound twice, after which `findOne` returns whichever row it reached first and
 * one Google identity signs into two farms depending on the wind.
 */
describe('the Google subject binding', () => {
  const userIndexes = () => indexPlan().find(([name]) => name === 'users')?.[1] ?? [];

  it('is indexed at all, rather than scanned on every Google sign-in', () => {
    expect(userIndexes().find((index) => 'googleSub' in index.key)).toBeDefined();
  });

  it('is unique, so one Google account cannot hold two', () => {
    expect(userIndexes().find((index) => 'googleSub' in index.key)?.unique).toBe(true);
  });

  /**
   * Partial for two reasons, and the second is easy to miss: most accounts are
   * password-only and have no `googleSub` at all, and `disableUser` `$unset`s
   * the field when somebody is removed so their Google account can sign up
   * again. A plain `unique: true` would admit one row with the field missing
   * and refuse every other — every password-only signup, and every removal
   * after the first.
   */
  it('is partial, so accounts without one do not collide', () => {
    const bound = userIndexes().find((index) => 'googleSub' in index.key);

    expect(bound?.partialFilterExpression).toEqual({ googleSub: { $type: 'string' } });
  });
});

/**
 * The rows the sweeper looks for, and the index that stops it reading the log
 * to find them.
 *
 * `sweepFarm` asks for `{orgId, outcome: 'pending', serverTs: {$lt: an hour
 * ago}}`. Nothing carried `outcome`, so the only usable index was the cursor
 * pair — and that `$lt` matches very nearly every row a farm has ever written,
 * while the answer is normally zero rows. The pass therefore walked and fetched
 * the whole mutation log, hourly, per farm, to find nothing, at a cost that
 * grows for as long as the farm keeps records.
 *
 * Asserted here rather than only against a live server for the reason this file
 * already gives about D15: an index that exists only in a suite which skips
 * without a mongod is *"a thing somebody can forget to create"*.
 */
describe('the stranded-row index', () => {
  const mutationIndexes = () => indexPlan().find(([name]) => name === 'mutations')?.[1] ?? [];

  const pending = () =>
    mutationIndexes().find(
      (index) => 'outcome' in index.key && index.partialFilterExpression !== undefined,
    );

  it('exists, so the sweep seeks rather than scans', () => {
    expect(pending()).toBeDefined();
  });

  /** orgId first like everything else, then the match, then the age range. */
  it('leads with orgId and ends with serverTs', () => {
    expect(Object.keys(pending()?.key ?? {})).toEqual(['orgId', 'outcome', 'serverTs']);
  });

  /**
   * Partial is what makes it nearly free: a `pending` row exists only between a
   * log write and its projection, so the index is empty almost all the time. A
   * plain three-field index would carry an entry per mutation for ever, on the
   * hottest collection in the schema, to answer a question about the few rows
   * that are stuck.
   */
  it('is partial, so it holds only the rows that are actually stuck', () => {
    expect(pending()?.partialFilterExpression).toEqual({ outcome: 'pending' });
  });

  /**
   * **The one that would go wrong silently.** A `partialFilterExpression` is
   * stored in the catalogue when the index is built, so it is a literal by
   * necessity — and a literal that drifted from the value the sweeper queries
   * with would leave an index that matches nothing, a query that is served by a
   * full scan again, and nothing failing anywhere.
   */
  it('names the same state the sweeper actually queries for', () => {
    expect(pending()?.partialFilterExpression).toEqual({ outcome: PENDING });
  });
});
