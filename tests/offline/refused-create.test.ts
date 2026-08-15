import { beforeEach, describe, expect, it } from 'vitest';
import { newId, type Mutation, type MutationStatus } from '@steading/contracts';
import { discardRejected, listRejected, retryRejected } from '@steading/core/sync/inbox';
import { flushOnce, type SyncTransport } from '@steading/core/sync/flush';
import { checkIntegrity, enqueue } from '@steading/core/sync/queue';
import { pullOnce } from '@steading/core/sync/pull';
import { localStore } from '@steading/core/db/store';
import {
  currentDriver,
  freshStore,
  readAllRecords,
  readRecordsByEntity,
} from '../support/store';

/**
 * Taking back a record the server refused.
 *
 * Enqueue writes the projection optimistically, which is the whole point of
 * offline-first — but nothing ever took it back. A refused create left its
 * record exactly where the optimistic write put it, and no later pull could
 * repair it: hydration overwrites a target only when the server has a mutation
 * for it, and for a create the server refused there is none and never will be.
 *
 * The mirror of the server's outcome filter. That one stops a refused command
 * reaching other devices; this one stops it staying on the device that issued
 * it, which no server change can reach.
 */

const GROUP = { name: 'Alpha', species: 'chicken' as const, count: 12 };

function flock(targetId?: string) {
  return {
    entity: 'flock' as const,
    op: 'create' as const,
    payload: GROUP,
    ...(targetId === undefined ? {} : { targetId }),
  };
}

function eggLog(flockId: string) {
  return {
    entity: 'eggLog' as const,
    op: 'create' as const,
    payload: { occurredAt: 1_700_000_000_000, flockId, count: 18 },
  };
}

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

/** A pull that finds nothing new, which is what a refused create leaves behind. */
const emptyPull = () =>
  Promise.resolve({
    status: 200,
    body: { mutations: [], through: 0, throughId: null, more: false },
  });

async function groupNames(): Promise<string[]> {
  const rows = await readRecordsByEntity('flock');
  return rows.map((r) => (r.value as { name?: string }).name ?? '(unnamed)');
}

describe('a create the server refused', () => {
  /** Straight at the table, because nothing public counts it. */
async function undoRows(): Promise<number> {
  const row = await currentDriver().get<{ n: number }>('SELECT COUNT(*) AS n FROM record_undo');
  return row?.n ?? 0;
}

beforeEach(freshStore);

  /**
   * The reported shape, end to end: a Farm Hand adds a group, the role check
   * refuses it, they read the inbox and throw it away.
   */
  it('is gone from the device once the user discards it', async () => {
    await enqueue(flock());
    expect(await groupNames()).toEqual(['Alpha']);

    await flushOnce(respondAll('rejected', 'A hand cannot add a group.'));

    // Still there while it is a decision the user has not made.
    expect(await groupNames()).toEqual(['Alpha']);

    const [refused] = await listRejected();
    await discardRejected(refused!.id);

    expect(await groupNames()).toEqual([]);
  });

  /**
   * The part that made it permanent. Nothing on the server can repair this,
   * because the server has no mutation for a create it refused — so a pull
   * must not bring the phantom back, and before the revert nothing removed it.
   */
  it('stays gone across a pull that finds nothing', async () => {
    await enqueue(flock());
    await flushOnce(respondAll('rejected', 'no'));

    const [refused] = await listRejected();
    await discardRejected(refused!.id);

    await pullOnce(emptyPull);

    expect(await groupNames()).toEqual([]);
    expect(await readAllRecords()).toEqual([]);
  });

  /**
   * The record has to survive until the decision is made, or "Send it again"
   * has nothing to send and the user reads about a group they cannot see.
   */
  it('survives a retry, which is why the revert is not at rejection time', async () => {
    await enqueue(flock());
    await flushOnce(respondAll('rejected', 'no'));

    const [refused] = await listRejected();
    await retryRejected(refused!.id);

    expect(await groupNames()).toEqual(['Alpha']);
    expect(await listRejected()).toEqual([]);

    // And it sticks once the server takes it.
    await flushOnce(respondAll('applied'));
    expect(await groupNames()).toEqual(['Alpha']);
  });

  it('leaves every other record alone', async () => {
    const kept = newId();
    await enqueue({ ...flock(kept), payload: { ...GROUP, name: 'Kept' } });
    await flushOnce(respondAll('applied'));

    await enqueue({ ...flock(), payload: { ...GROUP, name: 'Refused' } });
    await flushOnce(respondAll('rejected', 'no'));

    const [refused] = await listRejected();
    await discardRejected(refused!.id);

    expect(await groupNames()).toEqual(['Kept']);
  });

  /**
   * The guard. If the server accepted anything for this target the record is
   * real, whatever a later create said, and deleting it would be the same bug
   * pointing the other way.
   */
  it('keeps a record the server has already accepted', async () => {
    const targetId = newId();

    await enqueue(flock(targetId));
    await flushOnce(respondAll('applied'));

    // A second create against the same target — a resend the server refuses.
    await enqueue(flock(targetId));
    await flushOnce(respondAll('rejected', 'no'));

    const [refused] = await listRejected();
    await discardRejected(refused!.id);

    expect(await groupNames()).toEqual(['Alpha']);
  });

  /**
   * The residue, which used to be the open half of N-1.
   *
   * An update lands on a record that may have arrived from another device, so
   * reverting it needs a base value — and this test used to assert the opposite
   * of what it asserts now, pinning the limit *"still the optimistic value,
   * which is the residue this fix does not cover"*. The base value is kept
   * now: a pre-image written in the same transaction as the optimistic
   * projection (`record_undo`), which is the record itself rather than a
   * replay of local history.
   */
  it('puts a record back when a refused update is discarded', async () => {
    const targetId = newId();
    await enqueue(flock(targetId));
    await flushOnce(respondAll('applied'));

    await enqueue({ entity: 'flock', op: 'update', targetId, payload: { name: 'Edited' } });
    await flushOnce(respondAll('rejected', 'no'));
    expect(await groupNames()).toEqual(['Edited']);

    const [refused] = await listRejected();
    await discardRejected(refused!.id);

    expect(await groupNames()).toEqual(['Alpha']);
  });

  /** And the same for a delete, which left the record hidden for ever. */
  it('un-hides a record when a refused delete is discarded', async () => {
    const targetId = newId();
    await enqueue(flock(targetId));
    await flushOnce(respondAll('applied'));

    await enqueue({ entity: 'flock', op: 'delete', targetId, payload: {} });
    await flushOnce(respondAll('rejected', 'no'));
    expect((await readRecordsByEntity('flock'))[0]?.deleted).toBe(true);

    const [refused] = await listRejected();
    await discardRejected(refused!.id);

    const after = await readRecordsByEntity('flock');
    expect(after[0]?.deleted).toBe(false);
    expect(after[0]?.value).toMatchObject({ name: 'Alpha' });
  });

  /**
   * **Newer wins, and this is the case that makes the pre-image safe to keep.**
   *
   * A refused edit is not the last word on a record: a pull can deliver the
   * server's version while the refusal sits in the inbox, and the person may
   * not decide for days. Restoring over that would resurrect a value the farm
   * has moved past — a worse fault than the residue being cleared.
   *
   * The guard is the `updatedAt` the optimistic write produced. A record still
   * carrying it is a record nothing has touched since; anything else is newer.
   */
  it('leaves the record alone when something has touched it since', async () => {
    const targetId = newId();
    await enqueue(flock(targetId));
    await flushOnce(respondAll('applied'));

    await enqueue({ entity: 'flock', op: 'update', targetId, payload: { name: 'Edited' } });
    await flushOnce(respondAll('rejected', 'no'));

    // The server's own version arrives while the refusal waits in the inbox.
    await pullOnce(() =>
      Promise.resolve({
        status: 200,
        body: {
          mutations: [
            {
              schemaVersion: 1,
              id: `${'0'.repeat(20)}000001`,
              targetId,
              entity: 'flock',
              op: 'update',
              payload: { name: 'From the farm' },
              deviceId: '00000000-0000-4000-8000-0000000000ff',
              clientSeq: 0,
              clientTs: 1,
              serverTs: 50,
            },
          ],
          through: 50,
          throughId: `${'0'.repeat(20)}000001`,
          more: false,
        },
      }),
    );
    expect(await groupNames()).toEqual(['From the farm']);

    const [refused] = await listRejected();
    await discardRejected(refused!.id);

    expect(await groupNames()).toEqual(['From the farm']);
  });

  /**
   * A retry keeps its pre-image, because a rejected mutation is a decision
   * nobody has made yet — it may be refused a second time, and the revert has
   * to still be possible then.
   */
  it('can still put the record back after a retry is refused again', async () => {
    const targetId = newId();
    await enqueue(flock(targetId));
    await flushOnce(respondAll('applied'));

    await enqueue({ entity: 'flock', op: 'update', targetId, payload: { name: 'Edited' } });
    await flushOnce(respondAll('rejected', 'no'));

    const [first] = await listRejected();
    await retryRejected(first!.id);
    await flushOnce(respondAll('rejected', 'still no'));

    const [again] = await listRejected();
    await discardRejected(again!.id);

    expect(await groupNames()).toEqual(['Alpha']);
  });

  /**
   * The pre-image is a row per outstanding local edit, so it has to leave when
   * the edit does — in **both** directions. A table that only ever grew would
   * keep a copy of every value a farm had ever edited past, on a device whose
   * whole storage argument is that it holds one farm's records and no more.
   */
  it('keeps no pre-image for an edit the server accepted', async () => {
    const targetId = newId();
    await enqueue(flock(targetId));
    await flushOnce(respondAll('applied'));

    await enqueue({ entity: 'flock', op: 'update', targetId, payload: { name: 'Edited' } });
    expect(await undoRows()).toBe(1);

    await flushOnce(respondAll('applied'));
    expect(await undoRows()).toBe(0);
  });

  it('keeps none for a refused edit once it is discarded', async () => {
    const targetId = newId();
    await enqueue(flock(targetId));
    await flushOnce(respondAll('applied'));

    await enqueue({ entity: 'flock', op: 'update', targetId, payload: { name: 'Edited' } });
    await flushOnce(respondAll('rejected', 'no'));

    const [refused] = await listRejected();
    await discardRejected(refused!.id);

    expect(await undoRows()).toBe(0);
  });

  /** A create needs none: `dropRefusedCreate` takes the whole row back. */
  it('records no pre-image for a create', async () => {
    await enqueue(flock());

    expect(await undoRows()).toBe(0);
  });

  it('still counts the discard as cleared', async () => {
    await enqueue(flock());
    await flushOnce(respondAll('rejected', 'no'));

    const [refused] = await listRejected();
    await discardRejected(refused!.id);

    // A discard is a resolution. Reverting the projection must not make the
    // integrity check read it as data loss.
    expect((await checkIntegrity()).missing).toBe(0);
    expect(await listRejected()).toEqual([]);
  });

  /**
   * The phantom was not inert: a group nothing else had heard of still accepted
   * work. The tallies are this device's own records and are not swept up by the
   * revert — but the group they name is gone, so they stop being invisible.
   */
  it('leaves tallies logged against the phantom queued and visible', async () => {
    const targetId = newId();
    await enqueue(flock(targetId));
    await flushOnce(respondAll('rejected', 'no'));

    await enqueue(eggLog(targetId));

    const [refused] = await listRejected();
    await discardRejected(refused!.id);

    expect(await groupNames()).toEqual([]);
    expect(await readRecordsByEntity('eggLog')).toHaveLength(1);
    expect((await localStore().readOutboxBySeq()).map((m) => m.entity)).toEqual(['eggLog']);
  });
});
