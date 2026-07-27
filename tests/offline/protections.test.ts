import { beforeEach, describe, expect, it } from 'vitest';
import {
  db,
  listQuarantined,
  quarantineCount,
  readAllRecords,
  readOutboxBySeq,
  readRecordsByEntity,
  wipeLocalData,
} from '@/client/db/open';
import {
  type EnvelopeMigration,
  migrateEnvelope,
  UnmigratableEnvelopeError,
} from '@/client/db/migrate';
import { STORES } from '@/client/db/schema';
import { enqueue, queueDepth, unsentCount } from '@/client/sync/queue';
import { flushOnce } from '@/client/sync/flush';
import { listRejected } from '@/client/sync/inbox';
import { MUTATION_SCHEMA_VERSION } from '@steading/contracts';
import { newId } from '@steading/contracts';
import { freshDb } from '../support/idb';

function eggLog() {
  return {
    entity: 'eggLog' as const,
    op: 'create' as const,
    payload: { occurredAt: 1_700_000_000_000, flockId: newId(), count: 18 },
  };
}

/** Writes a row straight into the outbox, bypassing every guard. */
async function corruptRow(value: unknown): Promise<void> {
  await (await db()).put(STORES.outbox, value as never);
}

describe('corruption does not wedge the queue', () => {
  beforeEach(freshDb);

  it('quarantines an unreadable row and still returns the good ones', async () => {
    await enqueue(eggLog());
    await enqueue(eggLog());

    // The shape a botched migration or a devtools edit would leave behind.
    await corruptRow({ id: newId(), clientSeq: 'not a number', status: 'queued' });

    const queue = await readOutboxBySeq();

    // The two real mutations are still sendable — the whole point.
    expect(queue).toHaveLength(2);
    expect(await quarantineCount()).toBe(1);
  });

  it('keeps the raw value rather than deleting it', async () => {
    const id = newId();
    await corruptRow({ id, clientSeq: 'bad', marker: 'keep me' });

    await readOutboxBySeq();

    const [held] = await listQuarantined();
    expect(held?.raw).toMatchObject({ marker: 'keep me' });
    expect(held?.reason).toBeTruthy();
  });

  it('removes the bad row from the outbox so it is not re-read forever', async () => {
    await corruptRow({ id: newId(), clientSeq: 'bad' });

    await readOutboxBySeq();
    await readOutboxBySeq();

    // Quarantined once, not once per read.
    expect(await quarantineCount()).toBe(1);
  });

  it('lets a flush proceed past a corrupt row', async () => {
    await enqueue(eggLog());
    await corruptRow({ id: newId(), clientSeq: 'bad', status: 'queued' });

    const outcome = await flushOnce((mutations) =>
      Promise.resolve({
        status: 200,
        body: {
          results: mutations.map((m) => ({ id: m.id, status: 'applied' })),
          serverTs: Date.now(),
        },
      }),
    );

    expect(outcome.applied).toBe(1);
    expect(await queueDepth()).toBe(0);
  });

  it('quarantines an unreadable projection without failing the read', async () => {
    await enqueue(eggLog());
    await (await db()).put(STORES.records, { key: 'flock:bad', entity: 'flock' } as never);

    const records = await readAllRecords();

    expect(records).toHaveLength(1);
    expect(await quarantineCount()).toBe(1);
  });
});

describe('envelope migration (A7)', () => {
  it('returns a current envelope untouched', () => {
    const envelope = { schemaVersion: MUTATION_SCHEMA_VERSION, id: 'x' };
    expect(migrateEnvelope(envelope)).toBe(envelope);
  });

  it('walks every step of the ladder in order', () => {
    const seen: number[] = [];
    const ladder: Record<number, EnvelopeMigration> = {
      1: (raw) => {
        seen.push(1);
        return { ...raw, addedAtV2: true };
      },
      2: (raw) => {
        seen.push(2);
        return { ...raw, addedAtV3: true };
      },
    };

    const result = migrateEnvelope({ schemaVersion: 1, id: 'x' }, ladder, 3);

    // A device that skipped a version walks through both steps, not just the last.
    expect(seen).toEqual([1, 2]);
    expect(result).toMatchObject({ schemaVersion: 3, addedAtV2: true, addedAtV3: true });
  });

  it('refuses when a step is missing rather than guessing', () => {
    expect(() => migrateEnvelope({ schemaVersion: 1 }, {}, 3)).toThrow(UnmigratableEnvelopeError);
  });

  it('leaves an envelope from the future alone', () => {
    // A newer build wrote it. Guessing at a shape we do not know would corrupt
    // real work; the server rejects it with a message instead.
    const future = { schemaVersion: 99, id: 'x' };
    expect(migrateEnvelope(future, {}, 1)).toBe(future);
  });

  it('refuses an envelope with no usable version', () => {
    expect(() => migrateEnvelope({ id: 'x' })).toThrow(UnmigratableEnvelopeError);
  });
});

describe('session hygiene (C5)', () => {
  beforeEach(freshDb);

  it('clears every store, so the next sign-in sees nothing', async () => {
    await enqueue(eggLog());
    await enqueue({
      entity: 'flock',
      op: 'create',
      payload: { name: 'The Dexters', species: 'cattle', count: 4 },
    });
    await corruptRow({ id: newId(), clientSeq: 'bad' });
    await readOutboxBySeq();

    expect(await quarantineCount()).toBe(1);

    await wipeLocalData();

    // A shared barn tablet must not hand the previous farm's records to the
    // next person who signs in.
    expect(await readOutboxBySeq()).toEqual([]);
    expect(await readAllRecords()).toEqual([]);
    expect(await quarantineCount()).toBe(0);
    expect(await readRecordsByEntity('flock')).toEqual([]);

    const database = await db();
    expect(await database.count(STORES.meta)).toBe(0);
  });

  it('counts unsent work so the user can be warned before losing it', async () => {
    await enqueue(eggLog());
    await enqueue(eggLog());
    expect(await unsentCount()).toBe(2);

    await flushOnce((mutations) =>
      Promise.resolve({
        status: 200,
        body: {
          results: mutations.map((m) => ({ id: m.id, status: 'rejected', reason: 'no' })),
          serverTs: Date.now(),
        },
      }),
    );

    // Rejected work is still unsent — signing out would destroy it too.
    expect(await listRejected()).toHaveLength(2);
    expect(await unsentCount()).toBe(2);
  });

  it('reports zero once everything has reached the server', async () => {
    await enqueue(eggLog());
    await flushOnce((mutations) =>
      Promise.resolve({
        status: 200,
        body: {
          results: mutations.map((m) => ({ id: m.id, status: 'applied' })),
          serverTs: Date.now(),
        },
      }),
    );

    expect(await unsentCount()).toBe(0);
  });
});

describe('indexed reads', () => {
  beforeEach(freshDb);

  it('returns only the requested entity', async () => {
    await enqueue(eggLog());
    await enqueue({
      entity: 'flock',
      op: 'create',
      payload: { name: 'Goats', species: 'goat', count: 3 },
    });

    expect(await readRecordsByEntity('flock')).toHaveLength(1);
    expect(await readRecordsByEntity('eggLog')).toHaveLength(1);
    expect(await readRecordsByEntity('equipment')).toEqual([]);
  });
});
