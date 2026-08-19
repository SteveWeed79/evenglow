import { beforeEach, describe, expect, it } from 'vitest';

import { flushOnce, type SyncTransport } from '@homefarm/core/sync/flush';
import { checkIntegrity, enqueue, queueDepth } from '@homefarm/core/sync/queue';
import { nextDelay } from '@homefarm/core/sync/engine';
import { MAX_BATCH_SIZE, newId, type Mutation, type MutationStatus } from '@homefarm/contracts';
import { currentDriver, freshStore, readOutboxBySeq, simulateRestart } from '../support/store';

/**
 * The first flush of a farm that has been local-only, at the size it actually
 * arrives.
 *
 * `ACCESS-AND-BILLING.md` §6 named this as the one untested path and said why
 * it had become more pressing than when it was written: before A2.1 a device
 * could only accumulate a queue *after* signing in, so a first flush was small
 * by construction. Now the ordinary first-claim case is a farm handing over
 * everything it has ever logged — §4.1's "busy year" is 1,540 records, which is
 * sixteen batches rather than one.
 *
 * `flush.test.ts` covers a single batch thoroughly, including the cap itself.
 * What it stops short of is the *composition*: it enqueues `MAX_BATCH_SIZE + 5`,
 * flushes once, asserts five remain, and ends. Every one of its cases calls
 * `flushOnce` exactly once, so the repeated-flush drain a real first sync needs
 * had no coverage at any size.
 *
 * These assertions are about what survives sixteen round trips rather than one:
 * that ordering holds ACROSS batch boundaries and not merely within them, that
 * no mutation is sent twice or skipped as the window advances, that the audit
 * trail invariant 7 protects still holds at the end, and that a farm whose app
 * is killed mid-drain resumes rather than resending or losing work.
 */

/** A busy year, from `ACCESS-AND-BILLING.md` §4.1. Sixteen batches. */
const BUSY_YEAR = 1_540;

function eggLog() {
  return {
    entity: 'eggLog' as const,
    op: 'create' as const,
    payload: { occurredAt: 1_700_000_000_000, flockId: newId(), count: 18 },
  };
}

function respondAll(status: MutationStatus): SyncTransport {
  return (mutations: Mutation[]) =>
    Promise.resolve({
      status: 200,
      body: {
        results: mutations.map((m) => ({ id: m.id, status })),
        serverTs: Date.now(),
      },
    });
}

/**
 * A transport that records every batch it is handed.
 *
 * The batches are the evidence for most of what follows — the cap, the
 * ordering across boundaries, and whether anything was sent twice are all
 * questions about this array rather than about the store.
 */
function recordingTransport(status: MutationStatus = 'applied') {
  const batches: Mutation[][] = [];
  const transport: SyncTransport = (mutations) => {
    batches.push([...mutations]);
    return respondAll(status)(mutations);
  };
  return { batches, transport, sent: () => batches.flat() };
}

/**
 * Flushes until the queue is empty, the way the engine does.
 *
 * `nextDelay` is what decides this in production — "go again immediately only
 * if the last batch actually moved" — and it is unit-tested in
 * `pacing.test.ts`. Driving it here rather than looping blindly means the
 * drain being asserted is the one the engine would actually perform, and a
 * pacing rule that stopped mid-queue would fail this rather than hang it.
 *
 * The bound is a safety net, not a limit: at the cap, sixteen batches clear a
 * busy year, so anything near it means the drain is not making progress.
 */
async function drain(transport: SyncTransport, maxTicks = 100): Promise<number> {
  for (let tick = 0; tick < maxTicks; tick++) {
    const outcome = await flushOnce(transport);
    const resolved = outcome.applied + outcome.duplicate + outcome.rejected;
    const remaining = await queueDepth();

    const { delay } = nextDelay({ consecutiveFailures: 0, remaining, resolved });
    // Anything other than "go again now" means the engine would stop pushing:
    // either the queue is empty or it has stalled. Both end the drain.
    if (delay !== 0) return tick + 1;
  }
  throw new Error(`Queue did not drain within ${maxTicks} ticks`);
}

/** Raw outbox rows, including the applied ones `readOutboxBySeq` filters out. */
async function rawOutbox(): Promise<{ id: string; status: string; clientSeq: number }[]> {
  return currentDriver().all<{ id: string; status: string; clientSeq: number }>(
    'SELECT id, status, clientSeq FROM outbox ORDER BY clientSeq',
  );
}

describe('first flush at volume', () => {
  beforeEach(freshStore);

  it('drains a busy year to empty, one capped batch at a time', async () => {
    for (let i = 0; i < BUSY_YEAR; i++) await enqueue(eggLog());
    expect(await queueDepth()).toBe(BUSY_YEAR);

    const { batches, transport, sent } = recordingTransport();
    const ticks = await drain(transport);

    expect(await queueDepth()).toBe(0);
    expect(sent()).toHaveLength(BUSY_YEAR);
    expect(batches).toHaveLength(Math.ceil(BUSY_YEAR / MAX_BATCH_SIZE));
    expect(ticks).toBe(batches.length);

    // Every batch full except the last, which carries the remainder.
    const sizes = batches.map((b) => b.length);
    expect(sizes.slice(0, -1)).toEqual(sizes.slice(0, -1).map(() => MAX_BATCH_SIZE));
    expect(sizes.at(-1)).toBe(BUSY_YEAR % MAX_BATCH_SIZE);
  });

  it('sends each mutation exactly once across every batch', async () => {
    for (let i = 0; i < BUSY_YEAR; i++) await enqueue(eggLog());

    const { transport, sent } = recordingTransport();
    await drain(transport);

    // The failure this guards is a window that does not advance: `runFlush`
    // takes the first MAX_BATCH_SIZE queued rows, so a row left queued by
    // mistake would be resent in the next batch and every batch after it.
    const ids = sent().map((m) => m.id);
    expect(new Set(ids).size).toBe(BUSY_YEAR);
  });

  it('holds clientSeq order across batch boundaries, not just inside them', async () => {
    for (let i = 0; i < BUSY_YEAR; i++) await enqueue(eggLog());

    const { transport, sent } = recordingTransport();
    await drain(transport);

    /**
     * A4 is about the order the *server* sees, which is the concatenation of
     * every batch rather than any one of them. `flush.test.ts` asserts this
     * within a single batch of ten; a slice that sorted correctly per batch
     * while the batches themselves came out of order would pass that and fail
     * here, and the server would apply a month of a farm's work backwards.
     */
    const seqs = sent().map((m) => m.clientSeq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(BUSY_YEAR);
  });

  it('keeps every row as an applied audit trail rather than deleting it', async () => {
    for (let i = 0; i < BUSY_YEAR; i++) await enqueue(eggLog());

    await drain(recordingTransport().transport);

    /**
     * Invariant 7, at the size that makes it matter. `resolveBatch` marks a
     * cleared row `applied` rather than deleting it, and `readOutboxBySeq`
     * filters that status out because it is no longer work — so "the queue is
     * empty" and "the rows are gone" are different claims and only the first
     * is true.
     */
    const rows = await rawOutbox();
    expect(rows).toHaveLength(BUSY_YEAR);
    expect(rows.every((r) => r.status === 'applied')).toBe(true);
    expect(await readOutboxBySeq()).toEqual([]);
    expect((await checkIntegrity()).missing).toBe(0);
  });

  it('resumes mid-drain after the app is killed, without resending or losing work', async () => {
    for (let i = 0; i < BUSY_YEAR; i++) await enqueue(eggLog());

    // Three batches through, then the process dies without a graceful close.
    const before = recordingTransport();
    for (let i = 0; i < 3; i++) await flushOnce(before.transport);
    const sentBefore = before.sent().map((m) => m.id);
    expect(sentBefore).toHaveLength(3 * MAX_BATCH_SIZE);

    await simulateRestart();

    /**
     * The queue has to come back exactly as deep as it was left. A restart
     * that resent the first three batches would be relying on server-side
     * idempotency to cover a client-side bug, and one that lost them would be
     * silent data loss — the two failures a farm cannot tell apart from the
     * outside.
     */
    expect(await queueDepth()).toBe(BUSY_YEAR - 3 * MAX_BATCH_SIZE);

    const after = recordingTransport();
    await drain(after.transport);

    expect(await queueDepth()).toBe(0);

    const sentAfter = after.sent().map((m) => m.id);
    expect(sentAfter).toHaveLength(BUSY_YEAR - 3 * MAX_BATCH_SIZE);
    // Nothing from before the restart is sent a second time.
    expect(sentAfter.filter((id) => sentBefore.includes(id))).toEqual([]);
    // And between them they account for the whole year, once each.
    expect(new Set([...sentBefore, ...sentAfter]).size).toBe(BUSY_YEAR);
    expect((await checkIntegrity()).missing).toBe(0);
  });

  it('resumes the drain after a mid-drain network drop', async () => {
    for (let i = 0; i < BUSY_YEAR; i++) await enqueue(eggLog());

    for (let i = 0; i < 2; i++) await flushOnce(respondAll('applied'));
    const afterTwo = await queueDepth();

    // The barn: one batch fails to leave at all.
    const outcome = await flushOnce(() => Promise.reject(new Error('Failed to fetch')));
    expect(outcome.deferred).toBe('offline');
    expect(await queueDepth()).toBe(afterTwo);

    /**
     * A deferral is not progress, so the engine backs off rather than
     * hammering — the drain resumes on the next successful tick with nothing
     * dropped and nothing duplicated.
     */
    const paced = nextDelay({ consecutiveFailures: 1, remaining: afterTwo, resolved: 0 });
    expect(paced.delay).toBeGreaterThan(0);

    const { transport, sent } = recordingTransport();
    await drain(transport);

    expect(await queueDepth()).toBe(0);
    expect(new Set(sent().map((m) => m.id)).size).toBe(afterTwo);
    expect((await checkIntegrity()).missing).toBe(0);
  });

  it('does not wedge the drain when the server refuses one whole batch', async () => {
    for (let i = 0; i < 250; i++) await enqueue(eggLog());

    // The first batch is refused per-mutation; a rejection is resolved work,
    // so the window must still advance past it.
    await flushOnce(respondAll('rejected'));
    expect(await queueDepth()).toBe(150);

    const { transport, sent } = recordingTransport();
    await drain(transport);

    expect(await queueDepth()).toBe(0);
    expect(sent()).toHaveLength(150);

    // The refused hundred are kept as rejected rows for the inbox, not dropped.
    const rows = await rawOutbox();
    expect(rows.filter((r) => r.status === 'rejected')).toHaveLength(MAX_BATCH_SIZE);
    expect(rows.filter((r) => r.status === 'applied')).toHaveLength(150);
  });
});
