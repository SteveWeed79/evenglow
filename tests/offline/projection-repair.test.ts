import { beforeEach, describe, expect, it } from 'vitest';
import { newId, type Mutation, type MutationStatus } from '@steading/contracts';
import { discardRejected, listRejected } from '@steading/core/sync/inbox';
import { flushOnce, type SyncTransport } from '@steading/core/sync/flush';
import { enqueue } from '@steading/core/sync/queue';
import { pullOnce } from '@steading/core/sync/pull';
import { localStore } from '@steading/core/db/store';
import {
  deleteMetaKey,
  freshStore,
  readAllRecords,
  readRecordsByEntity,
  simulateRestart,
} from '../support/store';

/**
 * The one-time repair for devices that applied refused commands as truth.
 *
 * Filtering the feed stops it happening again and repairs nothing already on
 * disk: hydration only overwrites a target the server has a mutation for, and
 * for a command the server refused there is none. So a device replays the
 * accepted log from zero once, and then sweeps whatever the replay never
 * touched.
 *
 * **The replay alone is not enough, and that is the part the work list missed.**
 * It fixes every record the server still has history for, because a `create`
 * replaces the value whole. It cannot fix a record the server has nothing for —
 * a refused create that replicated leaves a row nothing will ever overwrite.
 * The sweep is what finds those, and it is why this is more than a watermark
 * reset.
 */

const GROUP = { name: 'Alpha', species: 'chicken' as const, count: 12 };

function flock(targetId?: string, payload: Record<string, unknown> = GROUP) {
  return {
    entity: 'flock' as const,
    op: 'create' as const,
    payload,
    ...(targetId === undefined ? {} : { targetId }),
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

interface FeedRow {
  targetId: string;
  entity: string;
  op: 'create' | 'update' | 'delete';
  payload: unknown;
  serverTs: number;
}

/** A server feed that pages the way the real one does. */
function feed(rows: FeedRow[], pageSize = 50) {
  return (since: number, sinceId: string | null) => {
    const withIds = rows.map((r, i) => ({
      schemaVersion: 1,
      id: `${'0'.repeat(20)}${String(i).padStart(6, '0')}`,
      targetId: r.targetId,
      entity: r.entity,
      op: r.op,
      payload: r.payload,
      deviceId: '00000000-0000-4000-8000-0000000000ff',
      clientSeq: i,
      clientTs: r.serverTs,
      serverTs: r.serverTs,
    }));

    const after = withIds.filter(
      (m) => m.serverTs > since || (m.serverTs === since && sinceId !== null && m.id > sinceId),
    );
    const page = after.slice(0, pageSize);
    const last = page[page.length - 1];

    return Promise.resolve({
      status: 200,
      body: {
        mutations: page,
        through: last ? last.serverTs : since,
        throughId: last ? last.id : sinceId,
        more: after.length > pageSize,
      },
    });
  };
}

const emptyFeed = () =>
  Promise.resolve({
    status: 200,
    body: { mutations: [], through: 0, throughId: null, more: false },
  });

/**
 * Winds this device back to before the repair existed.
 *
 * The setup pull in each test IS a repair — it runs on a fresh database, where
 * `repairDone` is absent — so without this the state under test would already
 * have been repaired by the arrangement that created it. Clearing the two
 * markers is exactly what a device carries when it upgrades into this build:
 * rows on disk, and no record of ever having been repaired.
 */
async function asPreRepairDevice(): Promise<void> {
  await deleteMetaKey('repairStarted');
  await deleteMetaKey('repairDone');
  await simulateRestart();
}

async function names(): Promise<string[]> {
  return (await readRecordsByEntity('flock')).map(
    (r) => (r.value as { name?: string }).name ?? '(unnamed)',
  );
}

describe('the one-time projection repair', () => {
  beforeEach(freshStore);

  /**
   * The archive that a conflicted update undid on every device except the one
   * that tried it. The accepted delete is still in the log, so replaying it
   * puts the record back where the farm left it.
   */
  it('restores an archive that a refused update undid', async () => {
    const targetId = newId();

    // What the device already has on disk: the archive, then the refused edit
    // it should never have received.
    await pullOnce(
      feed([
        { targetId, entity: 'flock', op: 'create', payload: GROUP, serverTs: 10 },
        { targetId, entity: 'flock', op: 'delete', payload: {}, serverTs: 20 },
        { targetId, entity: 'flock', op: 'update', payload: { name: 'Undone' }, serverTs: 30 },
      ]),
    );

    const before = await readRecordsByEntity('flock');
    expect(before[0]?.deleted).toBe(false);
    expect(before[0]?.value).toMatchObject({ name: 'Undone' });

    // The server now withholds the refused row, and the device replays.
    await asPreRepairDevice();
    const outcome = await pullOnce(
      feed([
        { targetId, entity: 'flock', op: 'create', payload: GROUP, serverTs: 10 },
        { targetId, entity: 'flock', op: 'delete', payload: {}, serverTs: 20 },
      ]),
    );

    const after = await readRecordsByEntity('flock');
    expect(after[0]?.deleted).toBe(true);
    expect(after[0]?.value).toMatchObject({ name: 'Alpha' });
    expect(outcome.repaired).toBe(0);
  });

  /** A refused update's merged fields go too, because the create replays whole. */
  it('rolls back a field a refused update had merged in', async () => {
    const targetId = newId();
    await pullOnce(
      feed([
        { targetId, entity: 'flock', op: 'create', payload: GROUP, serverTs: 10 },
        { targetId, entity: 'flock', op: 'update', payload: { count: 999 }, serverTs: 20 },
      ]),
    );
    expect((await readRecordsByEntity('flock'))[0]?.value).toMatchObject({ count: 999 });

    await asPreRepairDevice();
    await pullOnce(feed([{ targetId, entity: 'flock', op: 'create', payload: GROUP, serverTs: 10 }]));

    expect((await readRecordsByEntity('flock'))[0]?.value).toMatchObject({ count: 12 });
  });

  /**
   * The case a replay cannot reach. A create the server refused replicated to
   * this device, and there is no accepted mutation to overwrite it — so only
   * the sweep removes it.
   */
  it('sweeps a record the server has nothing for', async () => {
    const real = newId();
    const phantom = newId();

    await pullOnce(
      feed([
        { targetId: real, entity: 'flock', op: 'create', payload: GROUP, serverTs: 10 },
        {
          targetId: phantom,
          entity: 'flock',
          op: 'create',
          payload: { ...GROUP, name: 'Refused' },
          serverTs: 20,
        },
      ]),
    );
    expect((await names()).sort()).toEqual(['Alpha', 'Refused']);

    await asPreRepairDevice();
    const outcome = await pullOnce(
      feed([{ targetId: real, entity: 'flock', op: 'create', payload: GROUP, serverTs: 10 }]),
    );

    expect(await names()).toEqual(['Alpha']);
    expect(outcome.repaired).toBe(1);
  });

  /**
   * The device that ISSUED the refused create keeps it, because it is sitting
   * in that person's inbox waiting for a decision. Same rule `discardRejected`
   * follows, and the two must not disagree.
   */
  it('keeps a refused record this device still has in its inbox', async () => {
    await enqueue(flock(undefined, { ...GROUP, name: 'Mine' }));
    await flushOnce(respondAll('rejected', 'no'));
    expect(await listRejected()).toHaveLength(1);

    await asPreRepairDevice();
    const outcome = await pullOnce(emptyFeed);

    expect(await names()).toEqual(['Mine']);
    expect(outcome.repaired).toBe(0);

    // And discarding still takes it back, which is N-1's half of the same rule.
    const [refused] = await listRejected();
    await discardRejected(refused!.id);
    expect(await names()).toEqual([]);
  });

  it('keeps work this device has not sent yet', async () => {
    await enqueue(flock(undefined, { ...GROUP, name: 'Unsent' }));

    await asPreRepairDevice();
    const outcome = await pullOnce(emptyFeed);

    expect(await names()).toEqual(['Unsent']);
    expect(outcome.repaired).toBe(0);
  });

  /**
   * Non-destructive until the replay actually completes. A device that cannot
   * reach the server must keep every row it has — the alternative is an app
   * that empties itself in a barn.
   */
  it('sweeps nothing while the device is offline', async () => {
    const phantom = newId();
    await pullOnce(feed([{ targetId: phantom, entity: 'flock', op: 'create', payload: GROUP, serverTs: 10 }]));

    await asPreRepairDevice();
    const outcome = await pullOnce(() => Promise.reject(new Error('offline')));

    expect(outcome.deferred).toBe('offline');
    expect(outcome.repaired).toBeUndefined();
    expect(await names()).toEqual(['Alpha']);
  });

  /**
   * And nothing while the feed still has pages. A row that simply has not
   * arrived yet is indistinguishable from an orphan, so sweeping early would
   * delete records the server was about to send.
   */
  it('sweeps nothing until the feed runs out', async () => {
    // More rows than one pass can read: MAX_PAGES_PER_PASS is 20, so 25 rows
    // at one per page leaves the pass ending with `more` still true.
    const rows: FeedRow[] = [];
    for (let i = 0; i < 25; i++) {
      rows.push({ targetId: newId(), entity: 'flock', op: 'create', payload: GROUP, serverTs: 10 + i });
    }
    const phantom = newId();

    await pullOnce(feed(rows));
    await localStore().applyPulled(
      [
        {
          schemaVersion: 1,
          id: newId(),
          targetId: phantom,
          entity: 'flock',
          op: 'create',
          payload: { ...GROUP, name: 'Refused' },
          deviceId: '00000000-0000-4000-8000-0000000000ff',
          clientSeq: 99,
          clientTs: 1,
          serverTs: 99,
        },
      ],
      { through: 99, throughId: null },
    );
    expect(await names()).toHaveLength(26);

    await asPreRepairDevice();

    // First pass: reads 20 of the 25 and stops, so nothing is decided yet.
    const partial = await pullOnce(feed(rows, 1));
    expect(partial.more).toBe(true);
    expect(partial.repaired).toBeUndefined();
    expect(await names()).toHaveLength(26);

    // Second pass finishes the feed, and only now is the orphan provable.
    const rest = await pullOnce(feed(rows, 1));
    expect(rest.more).toBe(false);
    expect(rest.repaired).toBe(1);
    expect(await names()).toHaveLength(25);
  });

  /** Once done it stays done: no farm replays its history twice. */
  it('runs once and does not wind the watermark back again', async () => {
    const targetId = newId();
    const rows: FeedRow[] = [
      { targetId, entity: 'flock', op: 'create', payload: GROUP, serverTs: 10 },
    ];

    await pullOnce(feed(rows));
    expect(await localStore().projectionRepairDone()).toBe(true);

    const watermark = await localStore().pulledThrough();
    expect(watermark.through).toBe(10);

    const again = await pullOnce(feed(rows));
    expect(again.applied).toBe(0);
    expect(again.repaired).toBeUndefined();
    expect((await localStore().pulledThrough()).through).toBe(10);
  });

  it('leaves the outbox completely alone', async () => {
    await enqueue(flock());
    await flushOnce(respondAll('applied'));
    await enqueue(flock());

    const before = await localStore().readOutboxBySeq();

    await asPreRepairDevice();
    await pullOnce(emptyFeed);

    expect(await localStore().readOutboxBySeq()).toEqual(before);
    expect((await localStore().checkIntegrity()).missing).toBe(0);
  });

  it('survives being interrupted part way and finishes later', async () => {
    const real = newId();
    const phantom = newId();
    await pullOnce(
      feed([
        { targetId: real, entity: 'flock', op: 'create', payload: GROUP, serverTs: 10 },
        { targetId: phantom, entity: 'flock', op: 'create', payload: { ...GROUP, name: 'Refused' }, serverTs: 20 },
      ]),
    );

    await asPreRepairDevice();
    // Dies mid-replay.
    await pullOnce(() => Promise.reject(new Error('offline')));
    expect((await names()).sort()).toEqual(['Alpha', 'Refused']);

    await simulateRestart();
    const outcome = await pullOnce(
      feed([{ targetId: real, entity: 'flock', op: 'create', payload: GROUP, serverTs: 10 }]),
    );

    expect(await names()).toEqual(['Alpha']);
    expect(outcome.repaired).toBe(1);
  });

  it('leaves a device with nothing to repair unharmed', async () => {
    await pullOnce(emptyFeed);
    expect(await readAllRecords()).toEqual([]);
    expect(await localStore().projectionRepairDone()).toBe(true);
  });
});
