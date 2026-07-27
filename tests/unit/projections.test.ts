import { describe, expect, it } from 'vitest';
import { ENTITIES, isAppendOnly } from '@/lib/contracts/mutation';
import {
  decideHourReading,
  decideProjection,
  ENTITY_COLLECTIONS,
  type ExistingDoc,
} from '@/server/sync/projections';
import { COLLECTIONS } from '@/server/db/scoped';

const NOTHING = { existing: null };
const PRESENT: { existing: ExistingDoc } = { existing: { _id: 'id-1' } };
const ARCHIVED: { existing: ExistingDoc } = {
  existing: { _id: 'id-1', archivedAt: new Date('2026-01-01') },
};

describe('entity to collection mapping', () => {
  it('maps every entity to a real collection', () => {
    for (const entity of ENTITIES) {
      const collection = ENTITY_COLLECTIONS[entity];
      expect(collection).toBeDefined();
      expect(COLLECTIONS).toContain(collection);
    }
  });

  it('gives each entity its own collection', () => {
    const mapped = Object.values(ENTITY_COLLECTIONS);
    expect(new Set(mapped).size).toBe(mapped.length);
  });
});

describe('append-only projection (D3)', () => {
  const appendOnly = ENTITIES.filter(isAppendOnly).filter((e) => e !== 'hourReading');

  it.each(appendOnly)('%s inserts when absent', (entity) => {
    expect(decideProjection(entity, 'create', {}, NOTHING)).toEqual({ kind: 'insert' });
  });

  it.each(appendOnly)('%s is a no-op when already present', (entity) => {
    // Insert-if-absent: an immutable observation cannot conflict.
    expect(decideProjection(entity, 'create', {}, PRESENT)).toEqual({ kind: 'noop' });
  });

  it.each(appendOnly)('%s refuses an update even if one reaches this layer', (entity) => {
    const decision = decideProjection(entity, 'update', {}, PRESENT);
    expect(decision.kind).toBe('rejected');
  });
});

describe('hour-meter monotonicity', () => {
  it('accepts the first reading for a machine', () => {
    expect(decideHourReading({ hours: 412 }, null)).toEqual({ kind: 'insert' });
  });

  it('accepts a reading above the last one', () => {
    expect(decideHourReading({ hours: 413.5 }, 412)).toEqual({ kind: 'insert' });
  });

  it('accepts a reading equal to the last one', () => {
    // A machine that did not move still gets logged.
    expect(decideHourReading({ hours: 412 }, 412)).toEqual({ kind: 'insert' });
  });

  it('rejects a reading below the last one, naming the number to check', () => {
    const decision = decideHourReading({ hours: 41 }, 412);

    expect(decision.kind).toBe('rejected');
    // Plain, specific, no apology (UX-SPEC §6).
    expect(decision).toHaveProperty('reason', expect.stringContaining('412'));
    if (decision.kind === 'rejected') {
      expect(decision.reason).not.toMatch(/sorry|oops/i);
    }
  });

  it('rejects a reading with no numeric value', () => {
    expect(decideHourReading({ hours: 'four hundred' }, 412).kind).toBe('rejected');
    expect(decideHourReading({}, 412).kind).toBe('rejected');
  });

  it('routes through decideProjection for the hourReading entity', () => {
    const low = decideProjection('hourReading', 'create', { hours: 10 }, {
      existing: null,
      lastHours: 500,
    });
    expect(low.kind).toBe('rejected');
  });
});

describe('mutable projection', () => {
  it('creates when absent', () => {
    expect(decideProjection('flock', 'create', {}, NOTHING)).toEqual({ kind: 'insert' });
  });

  it('treats a replayed create as a no-op, not a second record', () => {
    expect(decideProjection('flock', 'create', {}, PRESENT)).toEqual({ kind: 'noop' });
  });

  it('updates an existing record', () => {
    expect(decideProjection('flock', 'update', {}, PRESENT)).toEqual({ kind: 'update' });
  });

  it('conflicts rather than upserting an update onto a missing record', () => {
    const decision = decideProjection('flock', 'update', {}, NOTHING);

    // Upserting here would resurrect something a user deliberately retired.
    expect(decision.kind).toBe('conflict');
  });

  it('conflicts on an update to an archived record', () => {
    const decision = decideProjection('equipment', 'update', {}, ARCHIVED);
    expect(decision.kind).toBe('conflict');
  });

  it('archives rather than deletes', () => {
    // History survives (P13).
    expect(decideProjection('flock', 'delete', {}, PRESENT)).toEqual({ kind: 'archive' });
  });

  it('treats deleting an already-archived record as a no-op', () => {
    expect(decideProjection('flock', 'delete', {}, ARCHIVED)).toEqual({ kind: 'noop' });
  });

  it('treats deleting a missing record as a no-op', () => {
    expect(decideProjection('flock', 'delete', {}, NOTHING)).toEqual({ kind: 'noop' });
  });

  it('never returns insert for an update, for any mutable entity', () => {
    for (const entity of ENTITIES.filter((e) => !isAppendOnly(e))) {
      expect(decideProjection(entity, 'update', {}, NOTHING).kind).toBe('conflict');
    }
  });
});
