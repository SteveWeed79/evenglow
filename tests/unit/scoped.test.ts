import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';
import {
  assertSafeUpdate,
  guardFilter,
  scopedOn,
  TenancyViolationError,
  type Tenanted,
} from '../../apps/api/src/db/scoped';

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
