import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { MutationResult } from '@steading/contracts';
import type { SessionClaims } from '@steading/api/auth/claims';
import { scopedOn } from '@steading/api/db/scoped';
import { applyBatch } from '@steading/api/sync/apply';
import { makeMutation } from '../support/fixtures';
import { startTestDb } from '../support/mongo';

/**
 * A3 idempotency and A4 ordering, exercised against the applier directly so
 * the assertions are about the write path rather than about HTTP.
 */

const harness = await startTestDb('steading_sync');
const describeDb = harness ? describe : describe.skip;

const ORG_A = ulid();

const OWNER: SessionClaims = { userId: ulid(), orgId: ORG_A, role: 'owner' };

function scope() {
  return scopedOn(harness!.db, ORG_A);
}

function statuses(results: MutationResult[]): string[] {
  return results.map((r) => r.status);
}

describeDb('sync applier', () => {
  afterAll(async () => {
    await harness?.stop();
  });

  beforeEach(async () => {
    await harness!.db.collection('mutations').deleteMany({});
  });

  it('applies a batch once', async () => {
    const batch = [makeMutation(), makeMutation(), makeMutation()];
    const results = await applyBatch(scope(), OWNER, batch);

    expect(statuses(results)).toEqual(['applied', 'applied', 'applied']);
    expect(await harness!.db.collection('mutations').countDocuments({})).toBe(3);
  });

  it('a replayed batch produces exactly one record per mutation', async () => {
    const batch = [makeMutation(), makeMutation()];

    await applyBatch(scope(), OWNER, batch);
    const replay = await applyBatch(scope(), OWNER, batch);
    const thirdTime = await applyBatch(scope(), OWNER, batch);

    expect(statuses(replay)).toEqual(['duplicate', 'duplicate']);
    expect(statuses(thirdTime)).toEqual(['duplicate', 'duplicate']);
    expect(await harness!.db.collection('mutations').countDocuments({})).toBe(2);
  });

  it('does not overwrite the first-applied record on replay', async () => {
    const mutation = makeMutation({ payload: { occurredAt: 1, flockId: ulid(), count: 18 } });
    await applyBatch(scope(), OWNER, [mutation]);

    const first = await harness!.db.collection('mutations').findOne({ _id: mutation.id as never });

    // Same idempotency key, different content — $setOnInsert must ignore it.
    const tampered = { ...mutation, payload: { ...(mutation.payload as object), count: 9999 } };
    const result = await applyBatch(scope(), OWNER, [tampered]);

    const after = await harness!.db.collection('mutations').findOne({ _id: mutation.id as never });
    expect(result[0]?.status).toBe('duplicate');
    expect(after?.payload).toEqual(first?.payload);
    expect(after?.serverTs).toEqual(first?.serverTs);
  });

  it('applies sequentially in clientSeq order regardless of array order', async () => {
    const a = makeMutation({ clientSeq: 10 });
    const b = makeMutation({ clientSeq: 11 });
    const c = makeMutation({ clientSeq: 12 });

    await applyBatch(scope(), OWNER, [c, a, b]);

    const docs = await harness!.db
      .collection('mutations')
      .find({})
      .sort({ clientSeq: 1 })
      .toArray();

    expect(docs.map((d) => d.clientSeq)).toEqual([10, 11, 12]);
    // serverTs is assigned per mutation as it is applied, so sequential
    // application shows up as a non-decreasing sequence.
    const times = docs.map((d) => (d.serverTs as Date).getTime());
    expect([...times].sort((x, y) => x - y)).toEqual(times);
  });

  it('records clientTs but orders by clientSeq (D6)', async () => {
    // A device whose clock ran backwards mid-queue.
    const first = makeMutation({ clientSeq: 1, clientTs: 2_000_000_000_000 });
    const second = makeMutation({ clientSeq: 2, clientTs: 1_000_000_000_000 });

    await applyBatch(scope(), OWNER, [first, second]);

    const docs = await harness!.db.collection('mutations').find({}).sort({ clientSeq: 1 }).toArray();
    expect(docs.map((d) => d.clientTs)).toEqual([2_000_000_000_000, 1_000_000_000_000]);
    expect(docs.map((d) => d._id)).toEqual([first.id, second.id]);
  });

  it('rejects a schema version the server cannot read', async () => {
    const future = makeMutation({ schemaVersion: 99 });
    const results = await applyBatch(scope(), OWNER, [future]);

    expect(results[0]?.status).toBe('rejected');
    expect(await harness!.db.collection('mutations').countDocuments({})).toBe(0);
  });

  it('rejects a bad payload without stopping the rest of the batch', async () => {
    const good = makeMutation();
    const bad = makeMutation({ payload: { occurredAt: 1, count: -5 } });
    const alsoGood = makeMutation();

    const results = await applyBatch(scope(), OWNER, [good, bad, alsoGood]);

    expect(statuses(results).filter((s) => s === 'applied')).toHaveLength(2);
    expect(statuses(results).filter((s) => s === 'rejected')).toHaveLength(1);
    expect(await harness!.db.collection('mutations').countDocuments({})).toBe(2);
  });

  it('never silently drops a mutation — every entry gets a result', async () => {
    const batch = [
      makeMutation(),
      makeMutation({ payload: { nonsense: true } }),
      makeMutation({ op: 'delete', payload: {} }),
      makeMutation({ schemaVersion: 99 }),
    ];

    const results = await applyBatch(scope(), OWNER, batch);

    expect(results).toHaveLength(batch.length);
    for (const mutation of batch) {
      expect(results.find((r) => r.id === mutation.id)).toBeDefined();
    }
    // Every rejection carries a reason the user can act on (A6).
    for (const result of results.filter((r) => r.status === 'rejected')) {
      expect(result.reason).toBeTruthy();
    }
  });
});
