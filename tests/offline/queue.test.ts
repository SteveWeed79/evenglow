import { beforeEach, describe, expect, it } from 'vitest';
import { db, readAllRecords, readOutboxBySeq } from '@steading/app/db/open';
import { STORES } from '@steading/app/db/idb-schema';
import { checkIntegrity, enqueue, InvalidMutationError, queueDepth } from '@steading/app/sync/queue';
import { newId } from '@steading/contracts';
import { freshDb, simulateRestart } from '../support/idb';

function eggLog(count = 18) {
  return {
    entity: 'eggLog' as const,
    op: 'create' as const,
    payload: { occurredAt: 1_700_000_000_000, flockId: newId(), count },
  };
}

describe('enqueue', () => {
  beforeEach(freshDb);

  it('assigns clientSeq from zero, monotonically', async () => {
    for (let i = 0; i < 5; i++) await enqueue(eggLog());

    const queue = await readOutboxBySeq();
    expect(queue.map((m) => m.clientSeq)).toEqual([0, 1, 2, 3, 4]);
  });

  it('keeps clientSeq monotonic across a restart', async () => {
    await enqueue(eggLog());
    await enqueue(eggLog());

    await simulateRestart();

    await enqueue(eggLog());
    const queue = await readOutboxBySeq();
    expect(queue.map((m) => m.clientSeq)).toEqual([0, 1, 2]);
  });

  it('derives a safe sequence floor when the counter is lost but work survives', async () => {
    await enqueue(eggLog());
    await enqueue(eggLog());
    await enqueue(eggLog());

    // Simulate a corrupted counter — the failure mode that would silently
    // reuse sequence numbers and break ordering.
    await (await db()).delete(STORES.meta, 'nextClientSeq');
    await simulateRestart();

    await enqueue(eggLog());
    const seqs = (await readOutboxBySeq()).map((m) => m.clientSeq);

    expect(seqs).toEqual([0, 1, 2, 3]);
    expect(new Set(seqs).size).toBe(seqs.length); // no reuse
  });

  it('mints one stable deviceId', async () => {
    await enqueue(eggLog());
    await simulateRestart();
    await enqueue(eggLog());

    const ids = new Set((await readOutboxBySeq()).map((m) => m.deviceId));
    expect(ids.size).toBe(1);
  });

  it('writes the optimistic projection in the same breath', async () => {
    const queued = await enqueue(eggLog(12));

    const records = await readAllRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.targetId).toBe(queued.targetId);
    expect(records[0]?.entity).toBe('eggLog');
  });

  it('refuses an operation the server would reject anyway', async () => {
    await expect(
      enqueue({ entity: 'eggLog', op: 'update', payload: { count: 1 } }),
    ).rejects.toThrow(InvalidMutationError);

    expect(await queueDepth()).toBe(0);
  });

  it('refuses a malformed payload before it can occupy the queue', async () => {
    await expect(
      enqueue({ entity: 'eggLog', op: 'create', payload: { occurredAt: 1, count: -3 } }),
    ).rejects.toThrow(InvalidMutationError);

    expect(await queueDepth()).toBe(0);
  });

  it('leaves no partial state when a mutation is refused', async () => {
    await enqueue(eggLog());
    await expect(enqueue({ entity: 'eggLog', op: 'create', payload: {} })).rejects.toThrow();

    // The rejected attempt must not have consumed a sequence number.
    await enqueue(eggLog());
    expect((await readOutboxBySeq()).map((m) => m.clientSeq)).toEqual([0, 1]);
  });
});

describe('integrity check', () => {
  beforeEach(freshDb);

  it('reports clean when nothing has been lost', async () => {
    for (let i = 0; i < 4; i++) await enqueue(eggLog());

    const report = await checkIntegrity();
    expect(report.everEnqueued).toBe(4);
    expect(report.actualInOutbox).toBe(4);
    expect(report.missing).toBe(0);
  });

  it('detects records that vanished without being acknowledged', async () => {
    for (let i = 0; i < 4; i++) await enqueue(eggLog());

    // Eviction, a failed migration, a devtools wipe — something removed work
    // the server never confirmed.
    const queue = await readOutboxBySeq();
    await (await db()).delete(STORES.outbox, queue[1]!.id);
    await (await db()).delete(STORES.outbox, queue[2]!.id);

    const report = await checkIntegrity();
    expect(report.expectedInOutbox).toBe(4);
    expect(report.actualInOutbox).toBe(2);
    expect(report.missing).toBe(2);
  });
});
