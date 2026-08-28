import { beforeEach, describe, expect, it } from 'vitest';
import {
  type EnvelopeMigration,
  migrateEnvelope,
  UnmigratableEnvelopeError,
} from '@homefarm/core/db/migrate';
import { enqueue, queueDepth, unsentCount } from '@homefarm/core/sync/queue';
import { flushOnce } from '@homefarm/core/sync/flush';
import { listRejected } from '@homefarm/core/sync/inbox';
import { localStore } from '@homefarm/core/db/store';
import { MUTATION_SCHEMA_VERSION, newId } from '@homefarm/contracts';
import {
  corruptRecordRow,
  metaCount,
  corruptRow,
  freshStore,
  listQuarantined,
  quarantineCount,
  readAllRecords,
  readOutboxBySeq,
  readRecordsByEntity,
  undecidedRowCount,
  unreadablePayloadRow,
  unreadableValueRow,
  wipeLocalData,
} from '../support/store';

function eggLog() {
  return {
    entity: 'eggLog' as const,
    op: 'create' as const,
    payload: { occurredAt: 1_700_000_000_000, flockId: newId(), count: 18 },
  };
}



describe('corruption does not wedge the queue', () => {
  beforeEach(freshStore);

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
    await corruptRow({ id, clientSeq: 'bad', targetId: 'keep me' });

    await readOutboxBySeq();

    const [held] = await listQuarantined();
    expect(held?.raw).toMatchObject({ targetId: 'keep me' });
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
    await corruptRecordRow('flock:bad');

    const records = await readAllRecords();

    expect(records).toHaveLength(1);
    expect(await quarantineCount()).toBe(1);
  });
});

/**
 * The corruption both helpers above were unable to express (H7).
 *
 * `corruptRow` leaves a valid payload and damages a typed column;
 * `corruptRecordRow` damages the JSON column *and* `updatedAt`. So in every
 * case above the parse failed for the other reason, and the case where the
 * JSON column is the **only** thing wrong had never been tried.
 *
 * It mattered because `payload` and `value` are `z.unknown()`, which is
 * satisfied by a key that is present and `undefined` and refused only when the
 * key is absent. An unparseable column read back as `undefined` therefore
 * *passed* the schema, quarantine was never reached, and `JSON.stringify` then
 * dropped the key on the way to the wire — so the server received a mutation
 * with no payload at all, answered 400 for the whole batch, and up to a
 * hundred good mutations behind it were marked rejected.
 */
describe('a column that is on disk but is not JSON', () => {
  beforeEach(freshStore);

  it('is quarantined rather than sent as a mutation with no payload', async () => {
    await enqueue(eggLog());
    await unreadablePayloadRow(newId());
    await enqueue(eggLog());

    const queue = await readOutboxBySeq();

    expect(queue).toHaveLength(2);
    expect(await quarantineCount()).toBe(1);
  });

  it('keeps the unreadable text itself, so the evidence survives', async () => {
    const id = newId();
    await unreadablePayloadRow(id);

    await readOutboxBySeq();

    const [held] = await listQuarantined();
    // The row as it sits on disk, corrupt column and all. The *mapped* object
    // would have the unreadable column silently missing, which is precisely
    // what hid this.
    expect(held?.raw).toMatchObject({ id, payload: '{"occurredAt": 170000' });
    expect(held?.reason).toContain('payload');
  });

  /**
   * The consequence, asserted where it actually bites: nothing reaches the
   * transport without a payload. That is the byte the server rejects the whole
   * batch over, and the batch is other farms' mornings.
   */
  it('never lets an envelope reach the wire without its payload', async () => {
    await enqueue(eggLog());
    await unreadablePayloadRow(newId());
    await enqueue(eggLog());

    const sent: Record<string, unknown>[] = [];
    await flushOnce((mutations) => {
      sent.push(...(mutations as unknown as Record<string, unknown>[]));
      return Promise.resolve({
        status: 200,
        body: {
          results: mutations.map((m) => ({ id: m.id, status: 'applied' })),
          serverTs: Date.now(),
        },
      });
    });

    expect(sent).toHaveLength(2);
    for (const envelope of sent) {
      expect(Object.hasOwn(envelope, 'payload')).toBe(true);
      expect(JSON.parse(JSON.stringify(envelope))).toHaveProperty('payload');
    }
  });

  /**
   * The projection half, which is worse in its own way: `value` is
   * `z.unknown()` too, so a record whose stored value would not parse used to
   * come back as a perfectly valid record with nothing in it — rendered on a
   * screen as a blank animal rather than quarantined as a broken row.
   */
  it('does not hand a screen a record with its contents missing', async () => {
    await enqueue(eggLog());
    await unreadableValueRow('flock:unreadable');

    const records = await readAllRecords();

    expect(records.map((r) => r.key)).not.toContain('flock:unreadable');
    expect(await quarantineCount()).toBe(1);
    const [held] = await listQuarantined();
    expect(held?.reason).toContain('value');
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
  beforeEach(freshStore);

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

    // A tally of answers that decided nothing is about this farm's outbox, so
    // it goes with it. Seeded here rather than assumed: an empty table would
    // pass the assertion below whether or not the wipe touches it.
    await localStore().recordUndecided(await readOutboxBySeq());
    expect(await undecidedRowCount()).toBeGreaterThan(0);

    await wipeLocalData();

    // A shared barn tablet must not hand the previous farm's records to the
    // next person who signs in.
    expect(await readOutboxBySeq()).toEqual([]);
    expect(await readAllRecords()).toEqual([]);
    expect(await quarantineCount()).toBe(0);
    expect(await readRecordsByEntity('flock')).toEqual([]);
    expect(await undecidedRowCount()).toBe(0);

    expect(await metaCount()).toBe(0);
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
  beforeEach(freshStore);

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
