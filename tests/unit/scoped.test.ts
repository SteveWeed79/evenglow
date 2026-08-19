import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';
import {
  assertSafeUpdate,
  guardFilter,
  scopedOn,
  TenancyViolationError,
  type Tenanted,
} from '@homefarm/api/db/scoped';

/**
 * The guard layer is the whole of D2, so it is tested directly rather than
 * only through a live server: these assertions hold with no mongod present.
 */

interface RecordedCall {
  method: string;
  args: unknown[];
}

function fakeDb(): { db: Db; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const record =
    (method: string, result: unknown) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return result;
    };

  const collection = () => ({
    findOne: record('findOne', Promise.resolve(null)),
    find: record('find', { limit: () => ({ toArray: () => Promise.resolve([]) }) }),
    countDocuments: record('countDocuments', Promise.resolve(0)),
    insertOne: record('insertOne', Promise.resolve({ acknowledged: true })),
    updateOne: record('updateOne', Promise.resolve({ upsertedCount: 1 })),
    deleteOne: record('deleteOne', Promise.resolve({ deletedCount: 1 })),
  });

  return { db: { collection } as unknown as Db, calls };
}

interface Doc extends Tenanted {
  name?: string;
}

describe('guardFilter', () => {
  it('ANDs orgId onto an empty filter', () => {
    expect(guardFilter('org-a')).toEqual({ orgId: 'org-a' });
  });

  it('preserves the caller filter', () => {
    expect(guardFilter('org-a', { name: 'Rhode Islands' })).toEqual({
      name: 'Rhode Islands',
      orgId: 'org-a',
    });
  });

  it('overrides a caller-supplied orgId rather than trusting it', () => {
    const filter = guardFilter<Doc>('org-a', { orgId: 'org-b' } as never);
    expect(filter).toEqual({ orgId: 'org-a' });
  });
});

describe('assertSafeUpdate', () => {
  it('allows an ordinary field update', () => {
    expect(() => assertSafeUpdate<Doc>({ $set: { name: 'Barred Rocks' } })).not.toThrow();
  });

  it('refuses to move a document to another tenant', () => {
    expect(() => assertSafeUpdate<Doc>({ $set: { orgId: 'org-b' } as never })).toThrow(
      TenancyViolationError,
    );
  });

  it('refuses to rewrite an identity', () => {
    expect(() => assertSafeUpdate<Doc>({ $set: { _id: 'other' } as never })).toThrow(
      TenancyViolationError,
    );
  });

  it('catches tenancy fields reached through a dotted path', () => {
    expect(() => assertSafeUpdate<Doc>({ $set: { 'orgId.x': 'org-b' } as never })).toThrow(
      TenancyViolationError,
    );
  });

  /**
   * **The half the guard was not looking at.**
   *
   * Every other operator names what it writes in its keys, so checking keys was
   * checking everything — until `$rename`, whose keys are what it reads and
   * whose values are what it writes. `{ $rename: { name: 'orgId' } }` passed
   * cleanly and would have moved the document to whatever that farm called
   * itself.
   *
   * Nothing builds a `$rename` in this service today, which is the reason to
   * close it rather than note it: this function exists so tenancy is a
   * mechanism and not a rule to remember, and whoever writes the first
   * `$rename` will trust it.
   */
  it('refuses a $rename that writes orgId, not just one that reads it', () => {
    expect(() => assertSafeUpdate<Doc>({ $rename: { name: 'orgId' } as never })).toThrow(
      TenancyViolationError,
    );
  });

  it('refuses a $rename that writes _id', () => {
    expect(() => assertSafeUpdate<Doc>({ $rename: { name: '_id' } as never })).toThrow(
      TenancyViolationError,
    );
  });

  it('refuses a $rename whose destination is a dotted path into orgId', () => {
    expect(() => assertSafeUpdate<Doc>({ $rename: { name: 'orgId.x' } as never })).toThrow(
      TenancyViolationError,
    );
  });

  /** Both halves, so the fix did not simply move the blind spot. */
  it('refuses a $rename that reads orgId as well', () => {
    expect(() => assertSafeUpdate<Doc>({ $rename: { orgId: 'name' } as never })).toThrow(
      TenancyViolationError,
    );
  });

  it('still allows a $rename between two ordinary fields', () => {
    expect(() =>
      assertSafeUpdate<Doc>({ $rename: { name: 'label' } as never }),
    ).not.toThrow();
  });

  it('catches tenancy fields under any operator, not just $set', () => {
    expect(() => assertSafeUpdate<Doc>({ $setOnInsert: { orgId: 'org-b' } as never })).toThrow(
      TenancyViolationError,
    );
    expect(() => assertSafeUpdate<Doc>({ $unset: { orgId: '' } as never })).toThrow(
      TenancyViolationError,
    );
  });
});

describe('scopedOn', () => {
  it('requires an orgId', () => {
    const { db } = fakeDb();
    expect(() => scopedOn(db, '')).toThrow(/orgId is required/);
  });

  it('scopes every read', async () => {
    const { db, calls } = fakeDb();
    const scope = scopedOn(db, 'org-a');

    await scope.col<Doc>('flocks').findOne({ name: 'x' });
    await scope.col<Doc>('flocks').findMany();
    await scope.col<Doc>('flocks').countDocuments();

    for (const call of calls.filter((c) => c.method !== 'find')) {
      expect(call.args[0]).toMatchObject({ orgId: 'org-a' });
    }
    expect(calls.map((c) => c.method)).toEqual(['findOne', 'find', 'countDocuments']);
  });

  it('stamps orgId on insert', async () => {
    const { db, calls } = fakeDb();
    await scopedOn(db, 'org-a').col<Doc>('flocks').insertOne({ _id: 'id-1', name: 'Layers' });

    expect(calls[0]?.args[0]).toEqual({ _id: 'id-1', name: 'Layers', orgId: 'org-a' });
  });

  it('scopes deletes', async () => {
    const { db, calls } = fakeDb();
    await scopedOn(db, 'org-a').col<Doc>('flocks').deleteOne({ _id: 'id-1' });

    expect(calls[0]?.args[0]).toEqual({ _id: 'id-1', orgId: 'org-a' });
  });

  it('stamps orgId into $setOnInsert on upsert', async () => {
    const { db, calls } = fakeDb();
    await scopedOn(db, 'org-a')
      .col<Doc>('mutations')
      .upsertOne({ _id: 'm-1' }, { $setOnInsert: { name: 'x' } });

    expect(calls[0]?.args[0]).toEqual({ _id: 'm-1', orgId: 'org-a' });
    expect(calls[0]?.args[1]).toEqual({ $setOnInsert: { name: 'x', orgId: 'org-a' } });
    expect(calls[0]?.args[2]).toEqual({ upsert: true });
  });

  it('refuses a cross-tenant update through the collection wrapper', () => {
    const { db, calls } = fakeDb();
    const flocks = scopedOn(db, 'org-a').col<Doc>('flocks');

    // Throws before the driver is reached, so the write is never attempted.
    expect(() => flocks.updateOne({ _id: 'id-1' }, { $set: { orgId: 'org-b' } as never })).toThrow(
      TenancyViolationError,
    );
    expect(calls).toHaveLength(0);
  });

  it('exposes no escape hatch', () => {
    const { db } = fakeDb();
    const flocks = scopedOn(db, 'org-a').col<Doc>('flocks');

    // bulkWrite cannot be transparently guarded, so it is deliberately absent
    // (Phase 1 spec T3). Sequential flush does not need it.
    expect(Object.keys(flocks).sort()).toEqual([
      'countDocuments',
      'deleteOne',
      'findMany',
      'findOne',
      'insertOne',
      'updateOne',
      'upsertOne',
    ]);
  });
});
