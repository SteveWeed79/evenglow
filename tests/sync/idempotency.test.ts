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

/**
 * File-level, not per-describe.
 *
 * A `afterAll` inside a suite runs when that suite finishes, so one nested in
 * the first describe would close the connection while the second describe
 * still had tests to run — and the harness is shared across both.
 */
afterAll(async () => {
  await harness?.stop();
});

describeDb('sync applier', () => {
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

/**
 * Taking back an append-only record (D3 as amended, §4 A10).
 *
 * Against the database rather than only `decideProjection`, because the two
 * things that can go wrong here are both queries: whether the archive actually
 * lands on the projection, and whether `highestHours` stops counting a reading
 * once it has been taken back. Neither is visible to a pure-function test, and
 * the second one is the entire reason the hour meter had to become removable.
 */
describeDb('taking an append-only record back', () => {
  beforeEach(async () => {
    await harness!.db.collection('mutations').deleteMany({});
    await harness!.db.collection('eggLogs').deleteMany({});
    await harness!.db.collection('hourReadings').deleteMany({});
  });

  it('archives rather than deleting, so the record survives its removal (P13)', async () => {
    const targetId = ulid();
    const created = makeMutation({ targetId, payload: { occurredAt: 1, flockId: ulid(), count: 12 } });
    const removed = makeMutation({ targetId, op: 'delete', payload: {} });

    await applyBatch(scope(), OWNER, [created, removed]);

    const doc = await harness!.db.collection('eggLogs').findOne({ _id: targetId as never });
    expect(doc).not.toBeNull();
    expect(doc?.archivedAt).toBeInstanceOf(Date);
    // The count it held is still there. Archived is not erased.
    expect(doc?.count).toBe(12);
  });

  it('removes once however many times the removal syncs', async () => {
    const targetId = ulid();
    const created = makeMutation({ targetId, payload: { occurredAt: 1, flockId: ulid(), count: 12 } });
    const removed = makeMutation({ targetId, op: 'delete', payload: {} });

    await applyBatch(scope(), OWNER, [created, removed]);
    const first = await harness!.db.collection('eggLogs').findOne({ _id: targetId as never });

    // The same removal arriving again — a retried flush, a second device.
    const replay = await applyBatch(scope(), OWNER, [created, removed]);
    const after = await harness!.db.collection('eggLogs').findOne({ _id: targetId as never });

    expect(statuses(replay)).toEqual(['duplicate', 'duplicate']);
    // Not merely "archived again": the same instant, so an archive is
    // genuinely repeatable and two devices cannot disagree about one.
    expect(after?.archivedAt).toEqual(first?.archivedAt);
    expect(await harness!.db.collection('eggLogs').countDocuments({})).toBe(1);
  });

  it('takes back a removal that arrives before the record it removes', async () => {
    // Out-of-order arrival across devices. The intent is satisfied — there is
    // nothing to archive — and it must not be an error.
    const removed = makeMutation({ op: 'delete', payload: {} });
    const results = await applyBatch(scope(), OWNER, [removed]);

    expect(results[0]?.status).toBe('applied');
    expect(await harness!.db.collection('eggLogs').countDocuments({})).toBe(0);
  });

  /**
   * The failure that made the hour meter removable rather than exempt.
   *
   * `decideHourReading` refuses anything below the highest reading recorded, so
   * a fat-fingered 9999 refuses every true reading for the rest of that
   * machine's life. Removing the typo is the only way out — which works only
   * if `highestHours` stops counting archived rows, and that is a query, so it
   * is asserted here rather than in the pure-function suite.
   */
  it('lets a machine be logged again once a mistyped reading is taken back', async () => {
    const equipmentId = ulid();
    const typoId = ulid();

    const reading = (hours: number, targetId = ulid()) =>
      makeMutation({
        targetId,
        entity: 'hourReading',
        payload: { occurredAt: 1_700_000_000_000, equipmentId, hours },
      });

    await applyBatch(scope(), OWNER, [reading(999), reading(9999, typoId)]);

    // Locked out: the true reading is below the typo, so the meter refuses it.
    const blocked = await applyBatch(scope(), OWNER, [reading(1002)]);
    expect(blocked[0]?.status).toBe('rejected');
    expect(blocked[0]?.reason).toContain('9999');

    await applyBatch(scope(), OWNER, [
      makeMutation({ targetId: typoId, entity: 'hourReading', op: 'delete', payload: {} }),
    ]);

    // 1002 is above 999, which is the highest that survives.
    const accepted = await applyBatch(scope(), OWNER, [reading(1002)]);
    expect(accepted[0]?.status).toBe('applied');

    const live = await harness!.db
      .collection('hourReadings')
      .find({ archivedAt: null })
      .sort({ hours: -1 })
      .toArray();
    expect(live.map((doc) => doc.hours)).toEqual([1002, 999]);
  });

  /**
   * A hand may take back what a hand may write. The role check runs per
   * mutation from the verified token, so this is the same path a phone in the
   * yard takes.
   */
  it('lets a hand remove an observation but never edit one', async () => {
    const HAND: SessionClaims = { userId: ulid(), orgId: ORG_A, role: 'hand' };
    const targetId = ulid();

    const results = await applyBatch(scope(), HAND, [
      makeMutation({ targetId, payload: { occurredAt: 1, flockId: ulid(), count: 12 } }),
      makeMutation({ targetId, op: 'update', payload: { count: 13 } }),
      makeMutation({ targetId, op: 'delete', payload: {} }),
    ]);

    expect(statuses(results)).toEqual(['applied', 'rejected', 'applied']);

    const doc = await harness!.db.collection('eggLogs').findOne({ _id: targetId as never });
    expect(doc?.count).toBe(12);
    expect(doc?.archivedAt).toBeInstanceOf(Date);
  });
});
