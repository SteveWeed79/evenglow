import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAllRecords } from '@/client/db/open';
import { pulledThrough, pullOnce, type PullTransport } from '@/client/sync/pull';
import { enqueue, queueDepth } from '@/client/sync/queue';
import { flushOnce } from '@/client/sync/flush';
import { MUTATION_SCHEMA_VERSION, type PulledMutation } from '@/lib/contracts/mutation';
import { newId } from '@/lib/ulid';
import { freshDb } from '../support/idb';

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

/** A server holding `pages`, handed out one at a time. */
function serve(pages: { mutations: PulledMutation[]; through: number; more: boolean }[]) {
  let call = 0;
  const transport: PullTransport = () => {
    const page = pages[call] ?? { mutations: [], through: 0, more: false };
    call += 1;
    return Promise.resolve({ status: 200, body: page });
  };
  return { transport, calls: () => call };
}

describe('pull', () => {
  beforeEach(freshDb);

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
        body: { mutations: [], through: since === 0 ? 500 : since, more: false },
      });
    };

    await pullOnce(transport);
    await pullOnce(transport);

    expect(seen).toEqual([0, 500]);
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
      Promise.resolve({ status: 200, body: { mutations: [], through: 0, more: true } });

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
      Promise.resolve({ status: 200, body: { mutations: [], through: 1, more: false } }),
    );

    await Promise.all([pullOnce(transport), pullOnce(transport), pullOnce(transport)]);

    expect(transport).toHaveBeenCalledTimes(1);
  });
});
