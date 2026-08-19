import { beforeEach, describe, expect, it, vi } from 'vitest';

import { discardRejected, listRejected, retryRejected } from '@homefarm/core/sync/inbox';
import { diagnostics, subscribe, type SyncState } from '@homefarm/core/sync/engine';
import { flushOnce, MAX_ATTEMPTS, type SyncTransport } from '@homefarm/core/sync/flush';
import { checkIntegrity, enqueue, queueDepth } from '@homefarm/core/sync/queue';
import { MAX_BATCH_SIZE, newId, type Mutation, type MutationStatus } from '@homefarm/contracts';
import { localStore } from '@homefarm/core/db/store';
import { freshStore, readOutboxBySeq } from '../support/store';

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
  beforeEach(freshStore);

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

  /**
   * The free tier, and the single most dangerous path in this file.
   *
   * A farm on D13's free tier flushes for months and is told 402 every time.
   * If that counted as a failed attempt, the queue would cross `MAX_ATTEMPTS`
   * and a farm's entire history would be swept into the rejected inbox as
   * poison — over a payment state, with nothing for anybody to look at, and
   * nothing anybody did wrong.
   *
   * So it takes the 401 shape exactly: queued, uncounted, untouched.
   */
  it('holds an unsubscribed farm without counting it against the retry budget', async () => {
    await enqueue(eggLog());
    await enqueue(eggLog());

    const held = () =>
      Promise.resolve({
        status: 402,
        body: { error: 'Kept on this phone. Everything works; nothing is sent anywhere.' },
      });

    // A year of mornings, compressed. Well past MAX_ATTEMPTS.
    for (let i = 0; i < 20; i += 1) {
      const outcome = await flushOnce(held);
      expect(outcome.deferred).toBe('unsubscribed');
    }

    expect(await queueDepth()).toBe(2);
    for (const row of await readOutboxBySeq()) {
      expect(row.attempts).toBe(0);
      // Not rejected, not applied — simply still waiting for the day the farm
      // subscribes, when the whole lot goes up.
      expect(row.status).toBe('queued');
    }
  });

  /**
   * The same shape, for the one refusal a farm can act on in a minute.
   *
   * A build the server will not take a batch from ([23], [24]) is not a batch
   * with anything wrong in it: the mutations are valid and the APK is old. So
   * it holds exactly as the free tier does — queued, uncounted, untouched —
   * because routing a farm's history to the rejected inbox over the version of
   * an app nobody told them to update would be the app punishing somebody for
   * its own delivery problem.
   */
  it('holds a batch from an app the server calls too old, and counts nothing', async () => {
    await enqueue(eggLog());
    await enqueue(eggLog());

    const tooOld = () =>
      Promise.resolve({
        status: 426,
        body: {
          error: 'Kept on this phone until this app is updated. Nothing has been lost.',
          refusal: 'appTooOld',
        },
      });

    for (let i = 0; i < 20; i += 1) {
      const outcome = await flushOnce(tooOld);
      expect(outcome.deferred).toBe('app-too-old');
    }

    expect(await queueDepth()).toBe(2);
    for (const row of await readOutboxBySeq()) {
      expect(row.attempts).toBe(0);
      expect(row.status).toBe('queued');
    }

    // And the chip can say which of the four states it is in.
    expect(await localStore().getSyncHeld()).toBe('appTooOld');
    expect((await diagnostics()).lastError).toMatch(/until this app is updated/);
  });

  it('shows the server’s own sentence about why it is holding', async () => {
    await enqueue(eggLog());

    await flushOnce(() =>
      Promise.resolve({
        status: 402,
        body: { error: 'Kept on this phone since the subscription ended. Nothing has been lost.' },
      }),
    );

    // The server knows which of the two states it is; the client shows what it
    // was told rather than guessing between them.
    expect((await diagnostics()).lastError).toMatch(/since the subscription ended/);
  });

  it('falls back to a sentence true in both states when the body is not readable', async () => {
    await enqueue(eggLog());

    // An API response is external data (invariant 11) and this one reaches a
    // screen, so a malformed body must not be rendered as-is.
    await flushOnce(() => Promise.resolve({ status: 402, body: { error: 42 } }));

    expect((await diagnostics()).lastError).toBe('Kept on this phone. Nothing has been lost.');
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
  beforeEach(freshStore);

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

/**
 * What the chip is allowed to say, which is a correctness question rather than
 * a cosmetic one.
 *
 * "Waiting" promises something is in flight. On a free-tier farm nothing is —
 * the batch is at rest — and a chip that says otherwise every morning for a
 * year teaches somebody that the app lies about sync. That is the exact
 * credibility the rejected state depends on.
 */
describe('what the device believes about being held', () => {
  beforeEach(freshStore);

  const held: SyncTransport = () =>
    Promise.resolve({ status: 402, body: { error: 'Kept on this phone.', refusal: 'unsubscribed' } });

  it('survives a cold start, so the first frame is not a lie', async () => {
    await enqueue(eggLog());
    await flushOnce(held);

    // Persisted rather than held in memory. In memory, a free-tier farm would
    // read "340 waiting" every morning until the first flush corrected it.
    expect(await localStore().getSyncHeld()).toBe('unsubscribed');
  });

  /** The state the engine publishes right now. `subscribe` emits on attach. */
  const stateNow = (): Promise<SyncState> =>
    new Promise((resolve) => {
      const off = subscribe((s) => {
        off();
        resolve(s);
      });
    });

  it('outranks queued, so the chip stops saying waiting', async () => {
    await enqueue(eggLog());

    // Before the server has answered, work genuinely is waiting.
    expect((await stateNow()).kind).toBe('queued');

    await flushOnce(held);

    // After, it is at rest and the chip must say so.
    const state = await stateNow();
    expect(state.kind).toBe('held');
    if (state.kind === 'held') {
      expect(state.count).toBe(1);
      expect(state.refusal).toBe('unsubscribed');
    }
  });

  /**
   * Something the server refused still needs a person, and no amount of
   * subscribing fixes it — so it keeps the top of the ranking even while the
   * farm is held.
   */
  it('is outranked by something that needs a look', async () => {
    await enqueue(eggLog());
    await flushOnce(held);
    expect((await stateNow()).kind).toBe('held');

    await enqueue(eggLog());
    await flushOnce((mutations) =>
      Promise.resolve({
        status: 200,
        body: {
          results: mutations.map((m) => ({ id: m.id, status: 'rejected' as const, reason: 'no' })),
        },
      }),
    );

    // A rejected mutation is a person's problem; being held is not.
    const state = await stateNow();
    expect(state.kind).toBe('rejected');
  });

  it('is cleared by a batch getting through, not by anything else', async () => {
    await enqueue(eggLog());
    await flushOnce(held);
    expect(await localStore().getSyncHeld()).toBe('unsubscribed');

    /**
     * The app is never told a payment succeeded — it finds out by being
     * allowed to write again. A farm that subscribes and then walks into a
     * barn stays "on this phone" until a flush actually lands, which is
     * correct: nothing has reached the server yet.
     */
    await flushOnce((mutations) =>
      Promise.resolve({
        status: 200,
        body: { results: mutations.map((m) => ({ id: m.id, status: 'applied' as const })) },
      }),
    );

    expect(await localStore().getSyncHeld()).toBeNull();
  });

  it('records which of the two states it is, without parsing prose', async () => {
    await enqueue(eggLog());
    await flushOnce(() =>
      Promise.resolve({ status: 402, body: { error: 'anything', refusal: 'lapsed' } }),
    );

    expect(await localStore().getSyncHeld()).toBe('lapsed');
  });

  it('falls back to the gentler state when the server does not say', async () => {
    await enqueue(eggLog());
    await flushOnce(() => Promise.resolve({ status: 402, body: {} }));

    // Telling a farm its subscription ended when it never had one, and telling
    // a lapsed farm it never subscribed, are the same size of confusion.
    // Neither is worth a branch that could be wrong in a third way.
    expect(await localStore().getSyncHeld()).toBe('unsubscribed');
  });
});
