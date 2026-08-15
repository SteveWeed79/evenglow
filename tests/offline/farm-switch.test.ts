import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { setLocalStore, localStore, storeGeneration } from '@steading/core/db/store';
import { openSqliteStore } from '@steading/core/db/sqlite-store';
import { flushOnce } from '@steading/core/sync/flush';
import { pullOnce } from '@steading/core/sync/pull';
import { enqueue, queueDepth } from '@steading/core/sync/queue';
import { freshStore, readRecordsByEntity } from '../support/store';
import { nodeIds, nodeSqlDriver } from '../support/sqlite';

/**
 * Switching farms is one transition, and it was several.
 *
 * A device holds one farm's database at a time and swaps files to change
 * farms, so "the store" is not a stable thing to have read a moment ago. The
 * sync loop reads the outbox, awaits a round trip, and writes the answers back
 * — and a switch landing inside that gap sent one farm's queued work under
 * another farm's token, or wrote another farm's results into this one's
 * outbox.
 *
 * **`scoped()` cannot see either.** The server is doing exactly what the token
 * it was given says; the mistake is entirely on the device, which is what makes
 * it silent in both directions — one farm's records land in another's database
 * attributed to a real user there, and the farm that recorded them loses the
 * work because the rows came back marked applied.
 */

function eggLog() {
  return {
    entity: 'eggLog' as const,
    op: 'create' as const,
    payload: { occurredAt: 1_700_000_000_000, flockId: newId(), count: 18 },
  };
}

/** Installs a second farm's store, exactly as `openLocalStore` would. */
async function switchFarm(): Promise<void> {
  setLocalStore(await openSqliteStore(nodeSqlDriver(), nodeIds()));
}

describe('the store generation', () => {
  beforeEach(freshStore);

  it('moves forward every time a farm is installed', async () => {
    const before = storeGeneration();
    await switchFarm();

    expect(storeGeneration()).toBeGreaterThan(before);
  });

  it('does not move while one farm stays open', async () => {
    const before = storeGeneration();
    await enqueue(eggLog());
    await localStore().readOutboxBySeq();

    expect(storeGeneration()).toBe(before);
  });
});

describe('a flush interrupted by a farm switch', () => {
  beforeEach(freshStore);

  /**
   * The dangerous half: this farm's work, sent under the next farm's token.
   * The switch happens while the transport is in flight, which is the widest
   * window and the one a real sign-in lands in.
   */
  it('does not send work once the farm has changed under it', async () => {
    await enqueue(eggLog());

    const outcome = await flushOnce(async () => {
      await switchFarm();
      return { status: 200, body: { results: [], serverTs: Date.now() } };
    });

    expect(outcome.deferred).toBe('farm-switched');
    expect(outcome.applied).toBe(0);
  });

  /**
   * And the answers go back to the farm that asked, or nowhere. Writing them
   * into another farm's outbox matches no rows while still moving its cleared
   * counter, which `checkIntegrity` would later read as that farm having lost
   * work.
   */
  it('does not write results into the farm that replaced it', async () => {
    await enqueue(eggLog());

    await flushOnce(async (mutations) => {
      const body = {
        results: mutations.map((m) => ({ id: m.id, status: 'applied' as const })),
        serverTs: Date.now(),
      };
      await switchFarm();
      return { status: 200, body };
    });

    /**
     * The cleared counter, not `missing`, is what actually catches this.
     * `missing` is clamped at zero, so a farm credited with clearing work it
     * never enqueued reads as perfectly healthy — the counter is the only place
     * the phantom shows.
     */
    const report = await localStore().checkIntegrity();
    expect(report.cleared).toBe(0);
    expect(report.everEnqueued).toBe(0);
    expect(await queueDepth()).toBe(0);
  });

  it("leaves the original farm's work queued for its own next pass", async () => {
    await enqueue(eggLog());
    const store = localStore();

    await flushOnce(async () => {
      await switchFarm();
      return { status: 200, body: { results: [], serverTs: Date.now() } };
    });

    // Nothing was sent, so nothing was resolved — the work is exactly where it
    // was, waiting for the farm it belongs to.
    expect(await store.readOutboxBySeq()).toHaveLength(1);
  });
});

describe('a pull interrupted by a farm switch', () => {
  beforeEach(freshStore);

  /**
   * The worst version of the hazard: one farm's records written into another
   * farm's database. No server check can catch it, because the server never
   * sees the mistake.
   */
  it('does not apply a page into the farm that replaced it', async () => {
    const outcome = await pullOnce(async () => {
      await switchFarm();
      return {
        status: 200,
        body: {
          mutations: [
            {
              schemaVersion: 1,
              id: `${'0'.repeat(20)}000000`,
              targetId: newId(),
              entity: 'flock',
              op: 'create',
              payload: { name: 'Somebody else', species: 'chicken', count: 12 },
              deviceId: '00000000-0000-4000-8000-0000000000ff',
              clientSeq: 0,
              clientTs: 1,
              serverTs: 10,
            },
          ],
          through: 10,
          throughId: `${'0'.repeat(20)}000000`,
          more: false,
        },
      };
    });

    expect(outcome.deferred).toBe('farm-switched');
    expect(await readRecordsByEntity('flock')).toEqual([]);
    expect((await localStore().pulledThrough()).through).toBe(0);
  });
});

describe('wiping a farm off a shared device (C5)', () => {
  beforeEach(freshStore);

  /**
   * `tickets.records` is the opt-in export a support report carries, so it is
   * a farm's records rather than a cache of somebody else's data — and it was
   * the one table the wipe walked past. Latent while nothing called `wipe`,
   * which is exactly why it had to be fixed before sign-out began to.
   */
  it('takes the support tickets with everything else', async () => {
    await enqueue(eggLog());
    await localStore().enqueueTicket({
      id: newId(),
      at: Date.now(),
      fingerprint: 'abc',
      bundle: '{"app":"steading"}',
      records: '{"flocks":[{"name":"Alpha"}]}',
      attempts: 0,
    });

    expect(await localStore().pendingTickets()).toHaveLength(1);

    await localStore().wipe();

    expect(await localStore().pendingTickets()).toEqual([]);
    expect(await localStore().readOutboxBySeq()).toEqual([]);
    expect(await readRecordsByEntity('eggLog')).toEqual([]);
  });
});
