import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { localStore } from '@steading/core/db/store';
import { enqueue } from '@steading/core/sync/queue';
import { type Farm, twoDevices } from '../support/devices';

/**
 * The harness itself, before anything is built on it.
 *
 * `SYNC-INTEGRITY-TODO.md` calls the two-device harness a prerequisite for four
 * of its outstanding tests, and the assertions those tests make are only worth
 * anything if the two devices are genuinely two. A harness that shared a
 * database, a device id or a sequence would let every one of them pass while
 * proving nothing — which is the failure mode a fixture is uniquely good at,
 * because nobody tests the thing they are testing with.
 *
 * So this file tests the harness. It needs no mongod, which is deliberate: the
 * suites that use it do, and this is the half that can be watched to fail.
 */

let farm: Farm;

beforeEach(async () => {
  farm = await twoDevices();
});

afterEach(async () => {
  await farm.close();
});

describe('two devices', () => {
  /**
   * A store mints its own uuid into `meta` on first enqueue. Two stores over
   * two files therefore identify differently without a line of production code
   * knowing this harness exists — but `clientSeq` is ordered *per device*
   * (invariant 4), so two devices sharing an id would silently make the whole
   * ordering contract meaningless.
   */
  it('identify as different phones', async () => {
    await farm.a.as(() => enqueue({ entity: 'flock', op: 'create', targetId: newId(), payload: aGroup() }));
    await farm.b.as(() => enqueue({ entity: 'flock', op: 'create', targetId: newId(), payload: aGroup() }));

    const a = await farm.a.deviceId();
    const b = await farm.b.deviceId();

    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  /**
   * Per device, and both starting at nought.
   *
   * `clientSeq` is a per-device counter, so B's first mutation is B's zeroth
   * whatever A has done. A shared counter would look almost right and would
   * make "A's second edit and B's first" impossible to express.
   */
  it('count their own mutations from zero', async () => {
    await farm.a.as(async () => {
      await enqueue({ entity: 'flock', op: 'create', targetId: newId(), payload: aGroup() });
      await enqueue({ entity: 'flock', op: 'create', targetId: newId(), payload: aGroup() });
    });

    const b = await farm.b.as(async () => {
      await enqueue({ entity: 'flock', op: 'create', targetId: newId(), payload: aGroup() });
      return localStore().readOutboxBySeq();
    });

    const a = await farm.a.as(() => localStore().readOutboxBySeq());

    expect(a.map((m) => m.clientSeq)).toEqual([0, 1]);
    expect(b.map((m) => m.clientSeq)).toEqual([0]);
  });

  /**
   * The one that would make every downstream assertion a lie.
   *
   * If the two stores shared a file, "device B does not have the refused edit"
   * would pass for the wrong reason on a suite that never wrote it to B at all
   * — and fail to notice the day it started arriving.
   */
  it('do not see each other’s records until something syncs', async () => {
    const group = newId();
    await farm.a.as(() => enqueue({ entity: 'flock', op: 'create', targetId: group, payload: aGroup() }));

    const onA = await farm.a.as(() => localStore().readRecordsByEntity('flock'));
    const onB = await farm.b.as(() => localStore().readRecordsByEntity('flock'));

    expect(onA).toHaveLength(1);
    expect(onB).toEqual([]);
  });

  /**
   * A block runs to completion under one store, which is what `runFlush`'s
   * generation guard requires — it captures `storeGeneration()` before its
   * first await and refuses if it moved.
   */
  it('put back whatever store was installed before', async () => {
    await farm.a.as(async () => {
      await farm.b.as(async () => {
        await enqueue({ entity: 'flock', op: 'create', targetId: newId(), payload: aGroup() });
      });

      // Back on A, so this lands on A and not on B.
      await enqueue({ entity: 'flock', op: 'create', targetId: newId(), payload: aGroup() });
    });

    expect(await farm.a.as(() => localStore().readRecordsByEntity('flock'))).toHaveLength(1);
    expect(await farm.b.as(() => localStore().readRecordsByEntity('flock'))).toHaveLength(1);
  });

  /** Nothing is installed on return, so a test cannot forget to say which. */
  it('install nothing until a device is named', async () => {
    const fresh = await twoDevices();
    expect(() => localStore()).toThrow(/No local store installed/);
    await fresh.close();
  });
});

function aGroup(): Record<string, unknown> {
  return { name: 'The hens', species: 'chicken', count: 6 };
}
