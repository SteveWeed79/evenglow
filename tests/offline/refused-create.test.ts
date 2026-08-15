import { beforeEach, describe, expect, it } from 'vitest';
import { newId, type Mutation, type MutationStatus } from '@steading/contracts';
import { discardRejected, listRejected, retryRejected } from '@steading/core/sync/inbox';
import { flushOnce, type SyncTransport } from '@steading/core/sync/flush';
import { checkIntegrity, enqueue } from '@steading/core/sync/queue';
import { pullOnce } from '@steading/core/sync/pull';
import { localStore } from '@steading/core/db/store';
import { freshStore, readAllRecords, readRecordsByEntity } from '../support/store';

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
   * Scoped on purpose. An update lands on a record that may have arrived from
   * another device, and reverting it needs a base value the projection does not
   * keep — so it is left alone rather than guessed at. Asserted so the limit is
   * visible rather than assumed; see N-1 in docs/SYNC-INTEGRITY-TODO.md.
   */
  it('does not touch a record when a refused update is discarded', async () => {
    const targetId = newId();
    await enqueue(flock(targetId));
    await flushOnce(respondAll('applied'));

    await enqueue({ entity: 'flock', op: 'update', targetId, payload: { name: 'Edited' } });
    await flushOnce(respondAll('rejected', 'no'));

    const [refused] = await listRejected();
    await discardRejected(refused!.id);

    // Still the optimistic value, which is the residue this fix does not cover.
    expect(await groupNames()).toEqual(['Edited']);
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
