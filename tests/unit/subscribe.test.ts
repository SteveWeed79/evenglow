import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { nudge, subscribe } from '@homefarm/core/sync/engine';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';

/**
 * Subscribing wakes the subscriber, and nobody else.
 *
 * `subscribe` used to call `publish()`, which walks every listener. So a
 * screen with five `useLive` hooks did twenty-five reads on mount instead of
 * five — waste, but survivable.
 *
 * What made it a defect is that `useLive` takes a `useCallback` reader, and a
 * reader's deps can come from another `useLive`'s result. Those results are
 * freshly built objects. Waking everybody on subscribe then closes a cycle: B
 * re-reads, hands back a new object, A's reader changes identity, A
 * resubscribes, which wakes B. The render loop never settles.
 *
 * `TrendScreen` hung on mount for exactly that reason, with no error and no
 * failing assertion — the test run simply never finished, which is the worst
 * way for a defect to present. Held here rather than in a screen test because
 * the rule is about the engine and any screen can trip it.
 */

/** Waits for the microtasks a subscribe schedules — its read is async. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  await freshStore();
});

describe('subscribing', () => {
  it('tells the new listener where things stand', async () => {
    let told = 0;
    const stop = subscribe(() => {
      told += 1;
    });

    await settle();
    expect(told).toBe(1);
    stop();
  });

  it('leaves the listeners already there alone', async () => {
    let first = 0;
    const stopFirst = subscribe(() => {
      first += 1;
    });
    await settle();
    expect(first).toBe(1);

    const stopSecond = subscribe(() => {});
    await settle();

    // The one that was already listening has a current value. Handing it
    // another is what closed the cycle above.
    expect(first).toBe(1);

    stopFirst();
    stopSecond();
  });

  /**
   * The thing subscribers are FOR. Narrowing the subscribe-time publish must
   * not narrow the one that matters — a write still reaches everybody, which
   * is how every screen in the app re-reads after a log.
   *
   * Through `nudge`, because that is the write path: `useLog` enqueues and
   * nudges, and the nudge is what publishes.
   */
  it('still tells everybody when something is written', async () => {
    let first = 0;
    let second = 0;
    const stopFirst = subscribe(() => {
      first += 1;
    });
    const stopSecond = subscribe(() => {
      second += 1;
    });
    await settle();

    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: newId(),
      payload: { name: 'The Crew', species: 'chicken', count: 6, purposes: ['eggs'] },
    });
    nudge();
    await settle();

    expect(first).toBeGreaterThan(1);
    expect(second).toBeGreaterThan(1);

    stopFirst();
    stopSecond();
  });

  /**
   * A screen that mounts and leaves inside one tick — which navigation does —
   * must not be handed a state after it has gone. React warns on a set after
   * unmount, and the warning is the honest one: nobody is listening.
   */
  it('says nothing to a listener that left while the read was in flight', async () => {
    let told = 0;
    const stop = subscribe(() => {
      told += 1;
    });

    stop();
    await settle();

    expect(told).toBe(0);
  });
});
