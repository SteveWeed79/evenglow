import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pulledThrough, pullOnce, type PullTransport } from '@steading/core/sync/pull';
import { enqueue, queueDepth } from '@steading/core/sync/queue';
import { flushOnce } from '@steading/core/sync/flush';
import { MUTATION_SCHEMA_VERSION, newId, type PulledMutation } from '@steading/contracts';
import { freshStore, readAllRecords } from '../support/store';

const DEVICE = '00000000-0000-4000-8000-0000000000ff';

function pulled(over: Partial<PulledMutation> = {}): PulledMutation {
  return {
    schemaVersion: MUTATION_SCHEMA_VERSION,
    id: newId(),
    targetId: newId(),
    entity: 'flock',
    op: 'create',
    payload: { name: 'The Dexters', species: 'cattle', count: 4 },
    deviceId: DEVICE,
    clientSeq: 0,
    clientTs: 1,
    serverTs: 1_000,
    ...over,
  };
}

interface Page {
  mutations: PulledMutation[];
  through: number;
  more: boolean;
  throughId?: string | null;
}

/**
 * A server holding `pages`, handed out one at a time.
 *
 * `throughId` defaults to the last mutation on the page, which is what a real
 * server returns — the cursor is the (serverTs, ULID) pair.
 */
function serve(pages: Page[]) {
  let call = 0;
  const seen: { since: number; sinceId: string | null }[] = [];

  const transport: PullTransport = (since, sinceId) => {
    seen.push({ since, sinceId });
    const page: Page = pages[call] ?? { mutations: [], through: 0, more: false };
    call += 1;
    const throughId =
      page.throughId !== undefined
        ? page.throughId
        : (page.mutations[page.mutations.length - 1]?.id ?? null);
    return Promise.resolve({ status: 200, body: { ...page, throughId } });
  };

  return { transport, calls: () => call, seen: () => seen };
}

describe('pull', () => {
  beforeEach(freshStore);

  it('hydrates a device that has recorded nothing itself', async () => {
    const mutation = pulled();
    const { transport } = serve([{ mutations: [mutation], through: 1_000, more: false }]);

    const outcome = await pullOnce(transport);

    expect(outcome.applied).toBe(1);
    const records = await readAllRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.targetId).toBe(mutation.targetId);
    expect(records[0]?.entity).toBe('flock');
  });

  it('advances the watermark so the next pass starts where this one ended', async () => {
    const { transport } = serve([{ mutations: [pulled()], through: 4_242, more: false }]);
    await pullOnce(transport);

    expect(await pulledThrough()).toBe(4_242);
  });

  it('sends the stored watermark back on the next pass', async () => {
    const seen: number[] = [];
    const transport: PullTransport = (since) => {
      seen.push(since);
      return Promise.resolve({
        status: 200,
        body: {
          mutations: [],
          through: since === 0 ? 500 : since,
          throughId: null,
          more: false,
        },
      });
    };

    await pullOnce(transport);
    await pullOnce(transport);

    expect(seen).toEqual([0, 500]);
  });

  it('sends both halves of the cursor back on the next pass', async () => {
    const first = pulled({ serverTs: 900 });
    const { transport, seen } = serve([{ mutations: [first], through: 900, more: false }]);

    await pullOnce(transport);
    await pullOnce(transport);

    // The second pass resumes from the pair, not from the timestamp alone.
    expect(seen()[0]).toEqual({ since: 0, sinceId: null });
    expect(seen()[1]).toEqual({ since: 900, sinceId: first.id });
  });

  /**
   * The client half of the same-millisecond regression. Two pages sharing one
   * serverTs: if the device resumed on the timestamp alone it would ask for
   * "> 700" and the server could never hand back the rest of that millisecond.
   */
  it('advances through a millisecond that spans more than one page', async () => {
    const a = pulled({ serverTs: 700 });
    const b = pulled({ serverTs: 700 });
    const { transport, seen } = serve([
      { mutations: [a], through: 700, more: true },
      { mutations: [b], through: 700, more: false },
    ]);

    const outcome = await pullOnce(transport);

    expect(outcome.applied).toBe(2);
    // Same timestamp both times — only the ULID moved, and that was enough.
    expect(seen()[1]).toEqual({ since: 700, sinceId: a.id });
    expect(await readAllRecords()).toHaveLength(2);
  });

  /**
   * The re-sort in applyPage was written, documented, and never called.
   *
   * Records are keyed by entity and targetId and written with put, so the last
   * write for a target wins. Two updates to one record arriving out of order
   * leave the older value in place — silently, and only on the device that
   * hydrated.
   */
  it('applies a page in server order, not the order it arrived in', async () => {
    const target = newId();
    const older = pulled({
      targetId: target,
      op: 'update',
      payload: { name: 'Older', species: 'goat', count: 1 },
      serverTs: 500,
    });
    const newer = pulled({
      targetId: target,
      op: 'update',
      payload: { name: 'Newer', species: 'goat', count: 2 },
      serverTs: 900,
    });

    // Server order is older-then-newer; this page arrives reversed.
    const { transport } = serve([{ mutations: [newer, older], through: 900, more: false }]);
    await pullOnce(transport);

    const [record] = await readAllRecords();
    expect(record?.value).toMatchObject({ name: 'Newer', count: 2 });
  });

  it('breaks a same-millisecond tie on the ULID, as the server does', async () => {
    const target = newId();
    // Same serverTs, so only the id decides. ULIDs sort lexicographically in
    // mint order, so the higher id is the later write.
    const first = pulled({ targetId: target, op: 'update', payload: { name: 'First' }, serverTs: 700 });
    const second = pulled({ targetId: target, op: 'update', payload: { name: 'Second' }, serverTs: 700 });
    const [lower, higher] =
      first.id < second.id ? [first, second] : [second, first];

    const { transport } = serve([
      { mutations: [higher, lower], through: 700, more: false },
    ]);
    await pullOnce(transport);

    const [record] = await readAllRecords();
    expect(record?.value).toMatchObject(higher.payload as Record<string, unknown>);
  });

  it('stops when neither half of the cursor advances', async () => {
    const stuck = newId();
    const transport: PullTransport = () =>
      Promise.resolve({
        status: 200,
        body: { mutations: [], through: 42, throughId: stuck, more: true },
      });

    // First pass stores the cursor; the second must not spin on it.
    await pullOnce(transport);
    const outcome = await pullOnce(transport);

    expect(outcome.applied).toBe(0);
  });

  it('follows pages until the server says there are no more', async () => {
    const { transport, calls } = serve([
      { mutations: [pulled({ serverTs: 1 })], through: 1, more: true },
      { mutations: [pulled({ serverTs: 2 })], through: 2, more: true },
      { mutations: [pulled({ serverTs: 3 })], through: 3, more: false },
    ]);

    const outcome = await pullOnce(transport);

    expect(calls()).toBe(3);
    expect(outcome.applied).toBe(3);
    expect(await readAllRecords()).toHaveLength(3);
  });

  it('does not loop forever on a page that cannot advance', async () => {
    // A server stuck at the same watermark with nothing to give.
    const transport: PullTransport = () =>
      Promise.resolve({
        status: 200,
        body: { mutations: [], through: 0, throughId: null, more: true },
      });

    const outcome = await pullOnce(transport);
    expect(outcome.applied).toBe(0);
  });

  it('never clobbers a record this device is still holding', async () => {
    // The device edits a group offline; the server replies with its older copy.
    const local = await enqueue({
      entity: 'flock',
      op: 'create',
      payload: { name: 'My name for it', species: 'goat', count: 9 },
    });

    const stale = pulled({
      targetId: local.targetId,
      payload: { name: 'Server name', species: 'goat', count: 2 },
    });
    const { transport } = serve([{ mutations: [stale], through: 1_000, more: false }]);

    const outcome = await pullOnce(transport);

    // A queued edit visibly reverting is the most alarming thing an offline
    // app can do, so local optimistic state wins until it flushes.
    expect(outcome.skipped).toBe(1);
    expect(outcome.applied).toBe(0);

    const [record] = await readAllRecords();
    expect(record?.value).toMatchObject({ name: 'My name for it', count: 9 });
  });

  it('accepts the server copy once the local edit has flushed', async () => {
    const local = await enqueue({
      entity: 'flock',
      op: 'create',
      payload: { name: 'Mine', species: 'goat', count: 9 },
    });

    await flushOnce((mutations) =>
      Promise.resolve({
        status: 200,
        body: {
          results: mutations.map((m) => ({ id: m.id, status: 'applied' })),
          serverTs: Date.now(),
        },
      }),
    );
    expect(await queueDepth()).toBe(0);

    const fromServer = pulled({
      targetId: local.targetId,
      payload: { name: 'Merged', species: 'goat', count: 11 },
    });
    const { transport } = serve([{ mutations: [fromServer], through: 2_000, more: false }]);

    const outcome = await pullOnce(transport);

    expect(outcome.applied).toBe(1);
    const [record] = await readAllRecords();
    expect(record?.value).toMatchObject({ name: 'Merged', count: 11 });
  });

  it('marks a deleted record rather than removing the projection', async () => {
    const target = newId();
    const { transport } = serve([
      {
        mutations: [pulled({ targetId: target, op: 'delete', payload: {} })],
        through: 1_000,
        more: false,
      },
    ]);

    await pullOnce(transport);

    const [record] = await readAllRecords();
    expect(record?.deleted).toBe(true);
  });

  it('keeps work queued and the watermark unmoved when offline', async () => {
    const outcome = await pullOnce(() => Promise.reject(new Error('Failed to fetch')));

    expect(outcome.deferred).toBe('offline');
    expect(await pulledThrough()).toBe(0);
  });

  it('defers on a lapsed session rather than treating it as empty', async () => {
    const outcome = await pullOnce(() => Promise.resolve({ status: 401, body: null }));

    expect(outcome.deferred).toBe('unauthenticated');
    expect(await readAllRecords()).toEqual([]);
  });

  it('refuses a response that does not match the contract', async () => {
    const outcome = await pullOnce(() =>
      Promise.resolve({ status: 200, body: { mutations: 'lots', through: 'soon' } }),
    );

    expect(outcome.deferred).toBe('unreadable');
    expect(await readAllRecords()).toEqual([]);
  });

  it('runs one pass at a time', async () => {
    const transport = vi.fn<PullTransport>(() =>
      Promise.resolve({
        status: 200,
        body: { mutations: [], through: 1, throughId: null, more: false },
      }),
    );

    await Promise.all([pullOnce(transport), pullOnce(transport), pullOnce(transport)]);

    expect(transport).toHaveBeenCalledTimes(1);
  });
});
