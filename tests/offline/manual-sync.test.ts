import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { openSqliteStore } from '@homefarm/core/db/sqlite-store';
import { setLocalStore, resetLocalStore } from '@homefarm/core/db/store';
import { nudge, setOnline, startSync, stopSync } from '@homefarm/core/sync/engine';
import { enqueue, queueDepth } from '@homefarm/core/sync/queue';
import { nodeIds, nodeSqlDriver } from '../support/sqlite';
import type { SyncTransport } from '@homefarm/core/sync/flush';

/**
 * "Try sending now", which is the button somebody presses when they do not
 * believe the app.
 *
 * Everything else in this engine is allowed to decide for itself when to try.
 * This one is not: it exists precisely for the case where the automatic rules
 * have got it wrong, and a manual override that obeys the state it is meant
 * to override is a decoration.
 *
 * The state it has to override is `online`. It is set from
 * `addNetworkStateListener`, which reports `isConnected: false` on transient
 * Android transitions and leaves it `undefined` on some configurations — and
 * `undefined === true` is false, so the engine believes it is offline on a
 * phone with four bars. `tick` then returns before flushing anything, which
 * means the press did nothing at all and said nothing about it.
 */

beforeEach(async () => {
  setLocalStore(await openSqliteStore(nodeSqlDriver(), nodeIds()));
});

afterEach(() => {
  stopSync();
  setOnline(true);
  resetLocalStore();
});

const eggLog = () => ({
  entity: 'eggLog' as const,
  op: 'create' as const,
  payload: { occurredAt: 1_700_000_000_000, flockId: newId(), count: 12 },
});

/** Records that a flush was attempted, and applies whatever it is given. */
function watchfulTransport(): { transport: SyncTransport; attempts: number } {
  const state = { attempts: 0 };

  const transport: SyncTransport = (mutations) => {
    state.attempts += 1;
    return Promise.resolve({
      status: 200,
      body: { results: mutations.map((m) => ({ id: m.id, status: 'applied' as const })) },
    });
  };

  return {
    transport,
    get attempts() {
      return state.attempts;
    },
  };
}

/** Lets the engine's scheduled work run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

describe('the manual send', () => {
  it('tries even when the engine believes it is offline', async () => {
    const server = watchfulTransport();

    startSync(server.transport);
    await settle();

    // The state the button exists for: the engine has been told there is no
    // network, whether or not that is true. The work is logged after that, so
    // it is sitting in the queue with no way out.
    setOnline(false);
    await enqueue(eggLog());
    await settle();

    const before = server.attempts;
    expect(await queueDepth()).toBe(1);

    nudge(server.transport, { force: true });
    await settle();

    expect(server.attempts).toBeGreaterThan(before);
    expect(await queueDepth()).toBe(0);
  });

  /**
   * And the automatic path is unchanged: a timer tick while offline must
   * still cost nothing, or a phone in a barn spends its battery on a radio
   * that is not there.
   */
  it('does not make the ordinary nudge ignore being offline', async () => {
    const server = watchfulTransport();

    startSync(server.transport);
    await settle();

    setOnline(false);
    await enqueue(eggLog());
    await settle();
    const before = server.attempts;

    nudge(server.transport);
    await settle();

    expect(server.attempts).toBe(before);
    // Still queued, which is the correct answer for a timer with no signal.
    expect(await queueDepth()).toBe(1);
  });

  /**
   * A forced send while genuinely offline fails as a network error, which the
   * queue has always handled: the work stays queued and nothing is lost. That
   * is the whole reason it is safe to let a person overrule the flag — the
   * flush is the authority on whether there is a network, and the listener is
   * only ever a hint.
   */
  it('keeps the work when the forced attempt fails', async () => {
    await enqueue(eggLog());

    startSync(() => Promise.reject(new Error('no route to host')));
    await settle();

    setOnline(false);
    nudge(() => Promise.reject(new Error('no route to host')), { force: true });
    await settle();

    expect(await queueDepth()).toBe(1);
  });
});
