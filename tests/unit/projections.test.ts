import { describe, expect, it } from 'vitest';
import { ENTITIES, isAppendOnly } from '@homefarm/contracts';
import {
  decideHourReading,
  decideProjection,
  ENTITY_COLLECTIONS,
  type ExistingDoc,
} from '@homefarm/api/sync/projections';
import { COLLECTIONS } from '@homefarm/api/db/scoped';

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

  /**
   * Immutable in value, removable in whole (D3, as amended).
   *
   * Every one of them, `hourReading` included — the meter is in this list
   * rather than exempted from it, and §4 A10 has the argument. Note the pair
   * these two describe blocks make: `update` rejected, `delete` archived. That
   * is the whole of what append-only now means.
   */
  const everyAppendOnly = ENTITIES.filter(isAppendOnly);

  it.each(everyAppendOnly)('%s can be taken back once written', (entity) => {
    expect(decideProjection(entity, 'delete', {}, PRESENT)).toEqual({ kind: 'archive' });
  });

  it.each(everyAppendOnly)('%s takes a second removal as a no-op, not an error', (entity) => {
    // The archive is `$set archivedAt` — repeatable, which is exactly why a
    // removal cannot conflict and sync stays insert-if-absent.
    expect(decideProjection(entity, 'delete', {}, ARCHIVED)).toEqual({ kind: 'noop' });
  });

  it.each(everyAppendOnly)('%s takes a removal of a record it never saw as a no-op', (entity) => {
    // The delete raced ahead of its own create, or arrived on a device that
    // never received one. The intent is satisfied either way.
    expect(decideProjection(entity, 'delete', {}, NOTHING)).toEqual({ kind: 'noop' });
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

  /**
   * The reason this entity had to become removable, stated as a test.
   *
   * A fat-fingered 9999 on a tractor that has done 999 makes every true
   * reading afterwards "below the last one", so the machine can never be
   * logged again. "Record the correct one instead" is not available — the rule
   * refuses the correction as readily as it refused nothing at all.
   *
   * `highestHours` skipping archived rows is the other half, and lives in
   * apply.ts; this half is that removing the typo is permitted at all.
   */
  it('locks a machine out of its own log until the bad reading is removed', () => {
    const typo = 9999;
    const real = 1002;

    expect(decideHourReading({ hours: real }, typo).kind).toBe('rejected');

    // The way out, and the only one.
    expect(decideProjection('hourReading', 'delete', {}, PRESENT)).toEqual({ kind: 'archive' });

    // With the typo archived, `highestHours` no longer counts it, so the true
    // reading is above the last one that survives.
    expect(decideHourReading({ hours: real }, 999)).toEqual({ kind: 'insert' });
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

/**
 * A hand finishing a photo, which is the half of the upload-stamp rule that
 * needs the document.
 *
 * `isUploadStamp` gets the mutation past the role gate; this decides whether
 * THIS photo is still waiting for it. Completing an upload is a hand's to
 * finish, a photo that already has bytes is not theirs to touch, and the two
 * answers have to come apart here because `canMutate` cannot see the record.
 */
describe('the photo upload stamp', () => {
  const HAND = { userId: 'user-1', role: 'hand' as const };
  const OWNER = { userId: 'user-2', role: 'owner' as const };

  const waiting: { existing: ExistingDoc } = { existing: { _id: 'photo-1' } };
  const finished: { existing: ExistingDoc } = {
    existing: { _id: 'photo-1', uploadedAt: 1_700_000_000_000 },
  };

  it('lets a hand stamp a photo that is still waiting for its bytes', () => {
    expect(
      decideProjection('photo', 'update', { uploadedAt: 1 }, { ...waiting, actor: HAND }),
    ).toEqual({ kind: 'update' });
  });

  /**
   * The retry has to stay honest for the same reason routes/photos.ts keys on
   * the record rather than on whether bytes are present: an upload whose answer
   * was lost has not stamped anything yet, and a retry that is refused is an
   * upload that can never finish.
   */
  it('refuses a hand re-stamping a photo that is already uploaded', () => {
    const decision = decideProjection(
      'photo',
      'update',
      { uploadedAt: 2 },
      { ...finished, actor: HAND },
    );

    expect(decision.kind).toBe('rejected');
  });

  it('leaves an owner free to change a photo at any point', () => {
    expect(
      decideProjection('photo', 'update', { caption: 'south gate' }, { ...finished, actor: OWNER }),
    ).toEqual({ kind: 'update' });
  });

  it('still refuses an update against a photo that is not there', () => {
    expect(
      decideProjection('photo', 'update', { uploadedAt: 1 }, { existing: null, actor: HAND }).kind,
    ).toBe('conflict');
  });

  it('still archives rather than deleting', () => {
    expect(decideProjection('photo', 'delete', {}, { ...waiting, actor: OWNER })).toEqual({
      kind: 'archive',
    });
  });
});
