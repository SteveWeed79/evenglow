import { beforeEach, describe, expect, it } from 'vitest';
import { flushOnce, MAX_ATTEMPTS, type SyncTransport } from '@steading/core/sync/flush';
import { listRejected } from '@steading/core/sync/inbox';
import { enqueue, queueDepth, rejectedCount } from '@steading/core/sync/queue';

import { newId } from '@steading/contracts';
import { freshStore, readOutboxBySeq } from '../support/store';

/**
 * A 200 that does not mention the mutation.
 *
 * This is the shape that produced a live hot loop: the server answers, the
 * response parses, nothing is rejected and nothing errors — but the row is
 * still queued afterwards. Keeping it queued is correct (resending is safe,
 * and silence must never be read as success), and the store counts the
 * attempt for exactly that reason. What was missing was anyone acting on the
 * count, so the mutation was resent forever, and the engine treated the round
 * trip as progress and immediately went again.
 */

const silent: SyncTransport = () =>
  Promise.resolve({ status: 200, body: { results: [], serverTs: Date.now() } });

const eggLog = () => ({
  entity: 'eggLog' as const,
  op: 'create' as const,
  payload: { occurredAt: 1_700_000_000_000, flockId: newId(), count: 18 },
});

describe('a server that answers without answering', () => {
  beforeEach(freshStore);

  it('keeps the work rather than assuming it landed', async () => {
    await enqueue(eggLog());

    const outcome = await flushOnce(silent);

    expect(outcome.applied).toBe(0);
    expect(outcome.duplicate).toBe(0);
    expect(outcome.rejected).toBe(0);
    expect(await queueDepth()).toBe(1);
  });

  it('counts every silent round trip', async () => {
    await enqueue(eggLog());

    await flushOnce(silent);
    await flushOnce(silent);

    const [row] = await readOutboxBySeq();
    expect(row?.attempts).toBe(2);
  });

  /**
   * The bound. Without it the count climbs forever and nothing ever looks at
   * it, which is a retry loop wearing the costume of a counter.
   */
  it('routes the mutation to the inbox once the attempts run out', async () => {
    await enqueue(eggLog());

    for (let i = 0; i < MAX_ATTEMPTS; i++) await flushOnce(silent);

    expect(await queueDepth()).toBe(0);
    expect(await rejectedCount()).toBe(1);

    const [rejected] = await listRejected();
    expect(rejected?.rejectedReason).toMatch(/without saying what happened/);
  });

  it('leaves the mutation alone while attempts remain', async () => {
    await enqueue(eggLog());

    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) await flushOnce(silent);

    // Still the user's work, still sendable — the ceiling has not been hit.
    expect(await queueDepth()).toBe(1);
    expect(await rejectedCount()).toBe(0);
  });

  /**
   * A partial answer must not take the answered rows down with the silent one.
   */
  it('only exhausts the mutations the server actually skipped', async () => {
    const kept = await enqueue(eggLog());
    await enqueue(eggLog());

    const partial: SyncTransport = (mutations) =>
      Promise.resolve({
        status: 200,
        body: {
          // Answers everything except the first.
          results: mutations
            .filter((m) => m.id !== kept.id)
            .map((m) => ({ id: m.id, status: 'applied' })),
          serverTs: Date.now(),
        },
      });

    for (let i = 0; i < MAX_ATTEMPTS; i++) await flushOnce(partial);

    const rejected = await listRejected();
    expect(rejected.map((m) => m.id)).toEqual([kept.id]);
    expect(await queueDepth()).toBe(0);
  });
});
