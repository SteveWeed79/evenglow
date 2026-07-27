import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  listQuarantined,
  quarantineCount,
  readAllRecords,
  readOutboxBySeq,
  readRecordsByEntity,
  wipeLocalData,
} from '../../apps/app/src/db/open';
import {
  type EnvelopeMigration,
  migrateEnvelope,
  UnmigratableEnvelopeError,
} from '../../apps/app/src/db/migrate';
import { enqueue, queueDepth, unsentCount } from '../../apps/app/src/sync/queue';
import { flushOnce } from '../../apps/app/src/sync/flush';
import { listRejected } from '../../apps/app/src/sync/inbox';
import { MUTATION_SCHEMA_VERSION } from '@steading/contracts';
import { newId } from '@steading/contracts';
import { cleanup, freshDb, raw } from '../support/sqlite';

function eggLog() {
  return {
    entity: 'eggLog' as const,
    op: 'create' as const,
    payload: { occurredAt: 1_700_000_000_000, flockId: newId(), count: 18 },
  };
}

afterAll(cleanup);

/**
 * Writes a row straight into the outbox, bypassing every guard.
 *
 * The columns are populated with values of the wrong shape rather than left
 * NULL, because that is what a botched migration or a hand-edited database
 * actually leaves behind: a row SQLite is perfectly happy with and the schema
 * is not.
 */
async function corruptRow(overrides: Record<string, string | number> = {}): Promise<string> {
  const id = typeof overrides.id === 'string' ? overrides.id : newId();

  await raw((database) =>
    database
      .prepare(
        `INSERT INTO outbox
           (id, schemaVersion, targetId, entity, op, payload, deviceId, clientSeq, clientTs,
            status, attempts, enqueuedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        1,
        'not-a-ulid',
        'eggLog',
        'create',
        JSON.stringify({ marker: overrides.marker ?? 'x' }),
        'not-a-uuid',
        // clientSeq must be an integer; a text value here is the corruption.
        String(overrides.clientSeq ?? 'not a number'),
        Date.now(),
        'queued',
        0,
        Date.now(),
      ),
  );

  return id;
}

describe('corruption does not wedge the queue', () => {
  beforeEach(freshDb);

  it('quarantines an unreadable row and still returns the good ones', async () => {
    await enqueue(eggLog());
    await enqueue(eggLog());

    // The shape a botched migration or a devtools edit would leave behind.
    await corruptRow();

    const queue = await readOutboxBySeq();

    // The two real mutations are still sendable — the whole point.
    expect(queue).toHaveLength(2);
    expect(await quarantineCount()).toBe(1);
  });

  it('keeps the raw value rather than deleting it', async () => {
    const id = await corruptRow({ marker: 'keep me' });

    await readOutboxBySeq();

    const [held] = await listQuarantined();
    expect(held?.key).toBe(id);
    expect(held?.raw).toMatchObject({ payload: { marker: 'keep me' } });
    expect(held?.reason).toBeTruthy();
  });

  it('removes the bad row from the outbox so it is not re-read forever', async () => {
    await corruptRow();

    await readOutboxBySeq();
    await readOutboxBySeq();

    // Quarantined once, not once per read.
    expect(await quarantineCount()).toBe(1);
  });

  it('lets a flush proceed past a corrupt row', async () => {
    await enqueue(eggLog());
    await corruptRow();

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
    await raw((database) =>
      database
        .prepare(
          `INSERT INTO records (key, entity, targetId, value, updatedAt, deleted)
           VALUES ('flock:bad', 'flock', 'bad', '{}', 'not a timestamp', 0)`,
        )
        .run(),
    );

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
    await corruptRow();
    await readOutboxBySeq();

    expect(await quarantineCount()).toBe(1);

    await wipeLocalData();

    // A shared barn tablet must not hand the previous farm's records to the
    // next person who signs in.
    expect(await readOutboxBySeq()).toEqual([]);
    expect(await readAllRecords()).toEqual([]);
    expect(await quarantineCount()).toBe(0);
    expect(await readRecordsByEntity('flock')).toEqual([]);

    const [meta] = await raw((database) =>
      database.prepare('SELECT COUNT(*) AS n FROM meta').all(),
    );
    expect((meta as { n: number } | undefined)?.n).toBe(0);
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
