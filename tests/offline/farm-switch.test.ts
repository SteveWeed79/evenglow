import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { setAccessToken } from '@homefarm/core/api';
import { setLocalStore, localStore, storeGeneration } from '@homefarm/core/db/store';
import { openSqliteStore } from '@homefarm/core/db/sqlite-store';
import { flushOnce } from '@homefarm/core/sync/flush';
import { pullOnce } from '@homefarm/core/sync/pull';
import { enqueue, queueDepth } from '@homefarm/core/sync/queue';
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
      bundle: '{"app":"homefarm"}',
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

/**
 * The half of the switch the generation counter cannot see (H2).
 *
 * `establish` sets the access token; the database for the farm being signed in
 * to is opened *afterwards*, by the boot, across a close, an open and a
 * migration ladder — and the engine loop is not stopped across that gap. So
 * there is a window, many awaits wide, where the bearer token is farm B's and
 * the SQLite file is still farm L's.
 *
 * **Both existing fences were blind to it**, because both compared
 * `storeGeneration()` to itself and in that window the store has not moved at
 * all. A tick landing there flushed farm L's queue under farm B's token — the
 * server takes `orgId` from the token, so those records were created in the
 * wrong org and came back `applied`, and the device that logged them never
 * sent them anywhere again — or pulled farm B's snapshot into farm L's file.
 *
 * `tests/offline/farm-switch.test.ts` only ever moved the store mid-transport,
 * which is why this was uncovered.
 */
const ORG_LEFT = '01J0000000000000000000000L';
const ORG_JOINED = '01J0000000000000000000000J';

/** What `openLocalStore` does: installs the store under the farm it holds. */
function nameCurrentFarm(orgId: string | null): void {
  setLocalStore(localStore(), orgId);
}

describe('a token that has moved ahead of the store', () => {
  beforeEach(async () => {
    await freshStore();
    setAccessToken(null, null);
  });

  afterEach(() => {
    setAccessToken(null, null);
  });

  it('sends nothing while the token and the store name different farms', async () => {
    nameCurrentFarm(ORG_LEFT);
    setAccessToken('the-joined-farms-token', ORG_JOINED);
    await enqueue(eggLog());

    let asked = false;
    const outcome = await flushOnce(async () => {
      asked = true;
      return { status: 200, body: { results: [], serverTs: Date.now() } };
    });

    // Not even attempted: the point is that the request never carries one
    // farm's work under the other's credentials.
    expect(asked).toBe(false);
    expect(outcome.deferred).toBe('farm-switching');
    expect(await queueDepth()).toBe(1);
  });

  /**
   * The mirror window. A pass that begins legitimately and has the token move
   * under it must not write the answers back either — resending is safe, since
   * the server dedupes on the mutation id, and marking rows applied on a farm
   * whose work may never have been sent is not.
   */
  it('does not write results back once the token has moved mid-flight', async () => {
    nameCurrentFarm(ORG_LEFT);
    setAccessToken('the-left-farms-token', ORG_LEFT);
    await enqueue(eggLog());
    const store = localStore();

    const outcome = await flushOnce(async (mutations) => {
      const body = {
        results: mutations.map((m) => ({ id: m.id, status: 'applied' as const })),
        serverTs: Date.now(),
      };
      // Signing in to the other farm, exactly as `establish` does it: token
      // first, database later.
      setAccessToken('the-joined-farms-token', ORG_JOINED);
      return { status: 200, body };
    });

    expect(outcome.deferred).toBe('farm-switching');
    expect(await store.readOutboxBySeq()).toHaveLength(1);

    // The cleared counter is what catches a phantom, for the reason the
    // generation suite above gives: `missing` is clamped at zero.
    const report = await store.checkIntegrity();
    expect(report.cleared).toBe(0);
  });

  it('asks for no page while the token and the store disagree', async () => {
    nameCurrentFarm(ORG_LEFT);
    setAccessToken('the-joined-farms-token', ORG_JOINED);

    let asked = false;
    const outcome = await pullOnce(async () => {
      asked = true;
      return {
        status: 200,
        body: { mutations: [], through: 10, throughId: `${'0'.repeat(20)}000000`, more: false },
      };
    });

    expect(asked).toBe(false);
    expect(outcome.deferred).toBe('farm-switching');
    expect((await localStore().pulledThrough()).through).toBe(0);
  });

  it('flushes normally once the database has caught up with the token', async () => {
    nameCurrentFarm(ORG_JOINED);
    setAccessToken('the-joined-farms-token', ORG_JOINED);
    await enqueue(eggLog());

    const outcome = await flushOnce(async (mutations) => ({
      status: 200,
      body: {
        results: mutations.map((m) => ({ id: m.id, status: 'applied' as const })),
        serverTs: Date.now(),
      },
    }));

    expect(outcome.deferred).toBeUndefined();
    expect(outcome.applied).toBe(1);
    expect(await queueDepth()).toBe(0);
  });

  /**
   * Null is *unknown*, not *any*, and it must not stall anything.
   *
   * Every device before its first sign-in has a store and no token, and a
   * fence that blocked on an absence would stop those farms syncing the moment
   * they signed in — which is a worse outage than the one being fixed, and
   * would buy nothing: authorization is the server's, re-derived from the
   * token on every mutation.
   */
  it('does not block when only one side knows which farm it is', async () => {
    nameCurrentFarm(ORG_LEFT);
    setAccessToken('a-token-nobody-named', null);
    await enqueue(eggLog());

    const first = await flushOnce(async (mutations) => ({
      status: 200,
      body: {
        results: mutations.map((m) => ({ id: m.id, status: 'applied' as const })),
        serverTs: Date.now(),
      },
    }));
    expect(first.applied).toBe(1);

    nameCurrentFarm(null);
    setAccessToken('the-joined-farms-token', ORG_JOINED);
    await enqueue(eggLog());

    const second = await flushOnce(async (mutations) => ({
      status: 200,
      body: {
        results: mutations.map((m) => ({ id: m.id, status: 'applied' as const })),
        serverTs: Date.now(),
      },
    }));
    expect(second.applied).toBe(1);
  });
});
