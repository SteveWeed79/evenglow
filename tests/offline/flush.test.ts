import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readOutboxBySeq } from '@steading/app/db/open';
import { discardRejected, listRejected, retryRejected } from '@steading/app/sync/inbox';
import { flushOnce, MAX_ATTEMPTS, type SyncTransport } from '@steading/app/sync/flush';
import { checkIntegrity, enqueue, queueDepth } from '@steading/app/sync/queue';
import { MAX_BATCH_SIZE, newId, type Mutation, type MutationStatus } from '@steading/contracts';
import { freshDb } from '../support/idb';

function eggLog() {
  return {
    entity: 'eggLog' as const,
    op: 'create' as const,
    payload: { occurredAt: 1_700_000_000_000, flockId: newId(), count: 18 },
  };
}

/** A transport that answers every mutation with the same status. */
function respondAll(status: MutationStatus, reason?: string): SyncTransport {
  return (mutations: Mutation[]) =>
    Promise.resolve({
      status: 200,
      body: {
        results: mutations.map((m) => ({ id: m.id, status, ...(reason ? { reason } : {}) })),
        serverTs: Date.now(),
      },
    });
}

describe('flush', () => {
  beforeEach(freshDb);

  it('clears applied mutations and records them as cleared', async () => {
    for (let i = 0; i < 3; i++) await enqueue(eggLog());

    const outcome = await flushOnce(respondAll('applied'));

    expect(outcome.applied).toBe(3);
    expect(await queueDepth()).toBe(0);
    expect((await checkIntegrity()).missing).toBe(0);
  });

  it('treats a duplicate as resolved, not as an error', async () => {
    await enqueue(eggLog());

    const outcome = await flushOnce(respondAll('duplicate'));

    expect(outcome.duplicate).toBe(1);
    expect(await readOutboxBySeq()).toEqual([]);
    expect((await checkIntegrity()).missing).toBe(0);
  });

  it('sends in clientSeq order', async () => {
    for (let i = 0; i < 10; i++) await enqueue(eggLog());

    const seen: number[] = [];
    await flushOnce((mutations) => {
      seen.push(...mutations.map((m) => m.clientSeq));
      return respondAll('applied')(mutations);
    });

    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('never sends more than the batch cap', async () => {
    for (let i = 0; i < MAX_BATCH_SIZE + 5; i++) await enqueue(eggLog());

    let sent = 0;
    await flushOnce((mutations) => {
      sent = mutations.length;
      return respondAll('applied')(mutations);
    });

    expect(sent).toBe(MAX_BATCH_SIZE);
    expect(await queueDepth()).toBe(5);
  });

  it('runs one batch at a time even when called concurrently', async () => {
    for (let i = 0; i < 3; i++) await enqueue(eggLog());

    const transport = vi.fn(respondAll('applied'));
    await Promise.all([flushOnce(transport), flushOnce(transport), flushOnce(transport)]);

    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('keeps work queued when the network is down', async () => {
    await enqueue(eggLog());

    const outcome = await flushOnce(() => Promise.reject(new Error('Failed to fetch')));

    expect(outcome.deferred).toBe('offline');
    expect(await queueDepth()).toBe(1);
    expect((await readOutboxBySeq())[0]?.attempts).toBe(1);
  });

  it('keeps work queued on a server error', async () => {
    await enqueue(eggLog());

    const outcome = await flushOnce(() => Promise.resolve({ status: 503, body: null }));

    expect(outcome.deferred).toBe('server-503');
    expect(await queueDepth()).toBe(1);
  });

  it('keeps work queued on a lapsed session without burning an attempt', async () => {
    await enqueue(eggLog());

    const outcome = await flushOnce(() => Promise.resolve({ status: 401, body: null }));

    expect(outcome.deferred).toBe('unauthenticated');
    expect(await queueDepth()).toBe(1);
    // Signing back in must not have cost the mutation part of its retry budget.
    expect((await readOutboxBySeq())[0]?.attempts).toBe(0);
  });

  it('keeps a mutation queued when the server omits it from the results', async () => {
    await enqueue(eggLog());
    await enqueue(eggLog());

    await flushOnce((mutations) =>
      Promise.resolve({
        status: 200,
        body: {
          results: [{ id: mutations[0]!.id, status: 'applied' }],
          serverTs: Date.now(),
        },
      }),
    );

    // Resending is safe, so silence is treated as "unknown", never as success.
    expect(await queueDepth()).toBe(1);
  });

  it('routes a rejection to the inbox instead of dropping it', async () => {
    await enqueue(eggLog());

    const outcome = await flushOnce(respondAll('rejected', 'Your role cannot create a flock.'));

    expect(outcome.rejected).toBe(1);
    expect(await queueDepth()).toBe(0);

    const inbox = await listRejected();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.rejectedReason).toBe('Your role cannot create a flock.');
    // Still counted as outstanding: it has not been resolved, only parked.
    expect((await checkIntegrity()).missing).toBe(0);
  });

  it('routes a conflict to the inbox too', async () => {
    await enqueue(eggLog());
    await flushOnce(respondAll('conflict'));

    expect(await listRejected()).toHaveLength(1);
  });

  it('parks a poison batch after the attempt ceiling rather than looping forever', async () => {
    await enqueue(eggLog());

    const unreadable: SyncTransport = () => Promise.resolve({ status: 400, body: { oops: true } });

    for (let i = 0; i < MAX_ATTEMPTS; i++) await flushOnce(unreadable);

    expect(await queueDepth()).toBe(0);
    const inbox = await listRejected();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.rejectedReason).toContain('could not read');
  });

  it('does nothing when the queue is empty', async () => {
    const transport = vi.fn(respondAll('applied'));
    const outcome = await flushOnce(transport);

    expect(outcome.attempted).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('rejected inbox', () => {
  beforeEach(freshDb);

  it('puts a retried mutation back in the queue with a clean slate', async () => {
    await enqueue(eggLog());
    await flushOnce(respondAll('rejected', 'nope'));

    const [rejected] = await listRejected();
    await retryRejected(rejected!.id);

    expect(await queueDepth()).toBe(1);
    const [requeued] = await readOutboxBySeq();
    expect(requeued?.attempts).toBe(0);
    expect(requeued?.rejectedReason).toBeUndefined();
  });

  it('accepts a corrected payload on retry', async () => {
    await enqueue(eggLog());
    await flushOnce(respondAll('rejected', 'bad count'));

    const [rejected] = await listRejected();
    const corrected = { occurredAt: 1, flockId: newId(), count: 6 };
    await retryRejected(rejected!.id, corrected);

    expect((await readOutboxBySeq())[0]?.payload).toEqual(corrected);
  });

  it('keeps the integrity check honest when the user discards', async () => {
    await enqueue(eggLog());
    await enqueue(eggLog());
    await flushOnce(respondAll('rejected', 'nope'));

    const [first] = await listRejected();
    await discardRejected(first!.id);

    // A discard is a resolution, so it must not later read as data loss.
    const report = await checkIntegrity();
    expect(report.missing).toBe(0);
    expect(await listRejected()).toHaveLength(1);
  });

  it('will not discard something still queued', async () => {
    const queued = await enqueue(eggLog());
    await discardRejected(queued.id);

    expect(await queueDepth()).toBe(1);
  });
});
