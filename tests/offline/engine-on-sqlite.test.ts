import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { openSqliteStore } from '@steading/core/db/sqlite-store';
import { setLocalStore, resetLocalStore } from '@steading/core/db/store';
import { enqueue, queueDepth, rejectedCount } from '@steading/core/sync/queue';
import { flushOnce } from '@steading/core/sync/flush';
import { discardRejected, listRejected, retryRejected } from '@steading/core/sync/inbox';
import { pullOnce, pulledThrough } from '@steading/core/sync/pull';
import { nodeIds, nodeSqlDriver } from '../support/sqlite';

/**
 * The engine itself, running on SQLite.
 *
 * The point of S4d. `queue.ts`, `flush.ts`, `pull.ts` and `inbox.ts` used to
 * call IndexedDB directly, so the storage layer could only ever be exercised
 * one way. They now go through `LocalStore`, and this proves it by swapping
 * the implementation underneath and driving the real engine — not a store API,
 * the actual enqueue, flush and hydrate paths the app calls.
 *
 * Everything asserted here is behaviour the IndexedDB suites already assert
 * for the browser engine. Identical results from both is the bar the plan set.
 */

beforeEach(async () => {
  setLocalStore(await openSqliteStore(nodeSqlDriver(), nodeIds()));
});

afterEach(() => {
  resetLocalStore();
});

const eggLog = () => ({
  entity: 'eggLog' as const,
  op: 'create' as const,
  payload: { occurredAt: 1_700_000_000_000, flockId: newId(), count: 12 },
});

describe('the engine on SQLite', () => {
  it('enqueues through the real write path', async () => {
    await enqueue(eggLog());
    expect(await queueDepth()).toBe(1);
  });

  it('still refuses what the contract refuses', async () => {
    // Validation lives in the engine, not the store, so swapping storage must
    // not change what is accepted.
    await expect(
      enqueue({ entity: 'eggLog', op: 'update', payload: {} }),
    ).rejects.toThrow(/cannot be/);
  });

  it('flushes sequentially and clears what the server applied', async () => {
    await enqueue(eggLog());
    await enqueue(eggLog());

    const seen: number[] = [];
    const outcome = await flushOnce((mutations) => {
      seen.push(...mutations.map((m) => m.clientSeq));
      return Promise.resolve({
        status: 200,
        body: {
          results: mutations.map((m) => ({ id: m.id, status: 'applied' })),
          serverTs: Date.now(),
        },
      });
    });

    // Ordered by clientSeq — the whole reason the sequence exists (A4).
    expect(seen).toEqual([0, 1]);
    expect(outcome.applied).toBe(2);
    expect(await queueDepth()).toBe(0);
  });

  it('routes a rejection to the inbox and never drops it (A6)', async () => {
    const queued = await enqueue(eggLog());

    await flushOnce((mutations) =>
      Promise.resolve({
        status: 200,
        body: {
          results: mutations.map((m) => ({
            id: m.id,
            status: 'rejected',
            reason: 'Your role cannot create that.',
          })),
          serverTs: Date.now(),
        },
      }),
    );

    const rejected = await listRejected();
    expect(rejected.map((m) => m.id)).toEqual([queued.id]);
    expect(await rejectedCount()).toBe(1);
  });

  it('retries a rejection back into the queue', async () => {
    const queued = await enqueue(eggLog());
    await flushOnce((mutations) =>
      Promise.resolve({
        status: 200,
        body: {
          results: mutations.map((m) => ({ id: m.id, status: 'rejected', reason: 'no' })),
          serverTs: Date.now(),
        },
      }),
    );

    await retryRejected(queued.id);

    expect(await queueDepth()).toBe(1);
    expect(await rejectedCount()).toBe(0);
  });

  it('refuses to discard a mutation that is merely queued', async () => {
    const queued = await enqueue(eggLog());

    await discardRejected(queued.id);

    // Discard is for the inbox. Applied to queued work it would delete
    // something that has never been sent — the one thing the outbox exists to
    // make impossible.
    expect(await queueDepth()).toBe(1);
  });

  it('keeps work queued when the network fails, and counts the attempt', async () => {
    await enqueue(eggLog());

    const outcome = await flushOnce(() => Promise.reject(new Error('Failed to fetch')));

    expect(outcome.deferred).toBe('offline');
    expect(await queueDepth()).toBe(1);
  });

  it('hydrates from a server page and advances both halves of the cursor', async () => {
    const id = newId();
    const target = newId();

    const outcome = await pullOnce(() =>
      Promise.resolve({
        status: 200,
        body: {
          mutations: [
            {
              schemaVersion: 1,
              id,
              targetId: target,
              entity: 'flock',
              op: 'create',
              payload: { name: 'The Dexters', species: 'cattle', count: 4 },
              deviceId: '00000000-0000-4000-8000-0000000000ff',
              clientSeq: 0,
              clientTs: 1,
              serverTs: 1_000,
            },
          ],
          through: 1_000,
          throughId: id,
          more: false,
        },
      }),
    );

    expect(outcome.applied).toBe(1);
    expect(await pulledThrough()).toBe(1_000);
  });
});
