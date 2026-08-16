import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';
import {
  activeWithdrawals,
  ENTITIES,
  hasATrigger,
  hasMergedInvariant,
  isAppendOnly,
  maintenanceCreateSchema,
  medicationCreateSchema,
  mergedUpdateProblem,
  namesOneSubject,
  payloadSchemaFor,
  type Entity,
  type TreatmentRecord,
} from '@steading/contracts';
import type { SessionClaims } from '@steading/api/auth/claims';
import { scopedOn } from '@steading/api/db/scoped';
import { applyBatch } from '@steading/api/sync/apply';
import { makeMutation } from '../support/fixtures';

/**
 * Invariants a `.partial()` update schema silently drops.
 *
 * Every update schema is `z.object(shape).partial().strict()`, and `.partial()`
 * does not carry the create schema's `.refine()`. So a rule that reads two
 * fields together — exactly one subject on a treatment, at least one trigger on
 * a schedule — was enforced on create and on nothing else, and the server
 * accepted an update that broke it from any client.
 *
 * The treatment case is the one that matters. `withdrawal.ts` resolved the
 * subject as `flockId ?? animalId`, so a treatment naming both held produce for
 * the group and **nothing** for the animal it also named — while
 * `read/withdrawals.ts` listed it against that animal. A screen showing a
 * treatment and reporting no withdrawal in force, in the one direction that
 * file says outright the app is written never to err.
 */

const ORG = 'org-a';
const OWNER: SessionClaims = { userId: 'user-1', orgId: ORG, role: 'owner' };

/**
 * Whether a create schema carries a refinement.
 *
 * Reaches into Zod's `_def`, which is private and could move on an upgrade —
 * acceptable in a test, where a break is visible and somebody re-derives it,
 * and the alternative is having no automatic guard at all.
 */
function isRefined(schema: unknown): boolean {
  const def = ((schema as { _def?: unknown })._def ?? {}) as { checks?: unknown };
  return Array.isArray(def.checks) && def.checks.length > 0;
}

describe('the table that keeps this from happening again', () => {
  /**
   * **This test is the actual fix.** The two entries in `MERGED_INVARIANTS` are
   * only the two instances that existed when it was written; without something
   * that fails, the next refined create inherits the same silent hole.
   */
  it('covers every mutable entity whose create schema is refined', () => {
    const missing: Entity[] = [];

    for (const entity of ENTITIES) {
      // Append-only entities have no update schema at all, so their refines
      // cannot be bypassed — `payloadSchemaFor(entity, 'update')` is undefined
      // and the applier refuses the op outright.
      if (isAppendOnly(entity)) continue;
      if (payloadSchemaFor(entity, 'update') === undefined) continue;

      const create = payloadSchemaFor(entity, 'create');
      if (create !== undefined && isRefined(create) && !hasMergedInvariant(entity)) {
        missing.push(entity);
      }
    }

    expect(missing).toEqual([]);
  });

  it('finds the two that were already broken', () => {
    expect(isRefined(medicationCreateSchema)).toBe(true);
    expect(isRefined(maintenanceCreateSchema)).toBe(true);
    expect(hasMergedInvariant('medication')).toBe(true);
    expect(hasMergedInvariant('maintenance')).toBe(true);
  });

  it('says nothing about an entity with no such invariant', () => {
    expect(mergedUpdateProblem('flock', { name: 'Alpha' })).toBeNull();
  });
});

describe('the predicates the create schemas refine on', () => {
  it('accepts exactly one treatment subject', () => {
    expect(namesOneSubject({ flockId: 'f' })).toBe(true);
    expect(namesOneSubject({ animalId: 'a' })).toBe(true);
    expect(namesOneSubject({ flockId: 'f', animalId: 'a' })).toBe(false);
    expect(namesOneSubject({})).toBe(false);
  });

  /**
   * Clearing a field arrives as `undefined` and the driver stores it as null,
   * so a merged document read back can hold null where a payload never could.
   */
  it('reads null as absent, which is what a cleared field becomes', () => {
    expect(namesOneSubject({ flockId: null, animalId: 'a' })).toBe(true);
    expect(namesOneSubject({ flockId: null, animalId: null })).toBe(false);
    expect(hasATrigger({ intervalHours: null, intervalDays: 30 })).toBe(true);
    expect(hasATrigger({ intervalHours: null, intervalDays: null })).toBe(false);
  });

  it('wants at least one schedule trigger', () => {
    expect(hasATrigger({ intervalHours: 100 })).toBe(true);
    expect(hasATrigger({ intervalDays: 30 })).toBe(true);
    expect(hasATrigger({ intervalHours: 100, intervalDays: 30 })).toBe(true);
    expect(hasATrigger({})).toBe(false);
  });
});

describe('the merged document', () => {
  it('refuses a treatment that would name both subjects', () => {
    expect(mergedUpdateProblem('medication', { flockId: 'f', animalId: 'a' })).toContain(
      'exactly one',
    );
  });

  it('refuses a treatment that would name neither', () => {
    expect(mergedUpdateProblem('medication', {})).toContain('exactly one');
  });

  it('allows an update that leaves one subject standing', () => {
    expect(mergedUpdateProblem('medication', { flockId: 'f', name: 'Renamed' })).toBeNull();
  });

  it('refuses a schedule left with no trigger', () => {
    expect(mergedUpdateProblem('maintenance', { title: 'Grease' })).toContain('interval');
  });
});

/** Enough Mongo to run one update through against a stored document. */
function fakeDb(existing: Record<string, unknown> | null) {
  const sets: unknown[] = [];
  const collection = (name: string) => ({
    findOne: () => Promise.resolve(name === 'mutations' ? null : existing),
    find: () => ({ limit: () => ({ sort: () => ({ toArray: () => Promise.resolve([]) }) }) }),
    countDocuments: () => Promise.resolve(0),
    insertOne: () => Promise.resolve({ acknowledged: true }),
    updateOne: (_f: unknown, update: Record<string, unknown>) => {
      if (name === 'medications' || name === 'maintenance') sets.push(update.$set);
      return Promise.resolve({ upsertedCount: 1 });
    },
    deleteOne: () => Promise.resolve({ deletedCount: 1 }),
  });
  return { db: { collection } as unknown as Db, sets };
}

describe('the applier, against the stored record', () => {
  const treatment = (over: Record<string, unknown> = {}) => ({
    _id: 'med-1',
    name: 'Amoxicillin',
    flockId: 'F'.repeat(26),
    administeredAt: 1_700_000_000_000,
    ...over,
  });

  it('refuses an update that would give a treatment two subjects', async () => {
    const { db, sets } = fakeDb(treatment());
    const [result] = await applyBatch(scopedOn(db, ORG), OWNER, [
      makeMutation({
        entity: 'medication',
        op: 'update',
        targetId: 'med-1',
        payload: { animalId: 'A'.repeat(26) },
      }),
    ]);

    expect(result?.status).toBe('rejected');
    expect(result?.reason).toContain('exactly one');
    expect(sets).toEqual([]);
  });

  it('lets an ordinary edit through', async () => {
    const { db, sets } = fakeDb(treatment());
    const [result] = await applyBatch(scopedOn(db, ORG), OWNER, [
      makeMutation({
        entity: 'medication',
        op: 'update',
        targetId: 'med-1',
        payload: { name: 'Amoxicillin LA' },
      }),
    ]);

    expect(result?.status).toBe('applied');
    expect(sets[0]).toMatchObject({ name: 'Amoxicillin LA' });
  });

  it('refuses an update that would leave a schedule with no trigger', async () => {
    const { db, sets } = fakeDb({
      _id: 'maint-1',
      equipmentId: 'E'.repeat(26),
      title: 'Grease',
      intervalDays: 30,
    });

    const [result] = await applyBatch(scopedOn(db, ORG), OWNER, [
      makeMutation({
        entity: 'maintenance',
        op: 'update',
        targetId: 'maint-1',
        payload: { intervalDays: undefined },
      }),
    ]);

    expect(result?.status).toBe('rejected');
    expect(sets).toEqual([]);
  });

  /**
   * A conflict is still a conflict. Reporting a validation message about a
   * write that was never going to happen would send somebody looking at the
   * wrong thing.
   */
  it('still reports a conflict against a record that is gone', async () => {
    const { db } = fakeDb(null);
    const [result] = await applyBatch(scopedOn(db, ORG), OWNER, [
      makeMutation({
        entity: 'medication',
        op: 'update',
        targetId: 'med-1',
        payload: { animalId: 'A'.repeat(26) },
      }),
    ]);

    expect(result?.status).toBe('conflict');
  });
});

describe('a withdrawal on a treatment that names both', () => {
  const both: TreatmentRecord = {
    id: 'med-1',
    name: 'Amoxicillin',
    flockId: 'flock-1',
    animalId: 'animal-1',
    administeredAt: 1_700_000_000_000,
    // Given and finished the same day. Stated rather than omitted: an absent
    // end date now means "the course is still running", which holds the
    // produce indefinitely — correct, and not what these assertions are about.
    treatmentEndsAt: 1_700_000_000_000,
    withdrawalDays: { milk: 7, meat: 28 },
  };

  const now = 1_700_000_000_000 + 24 * 60 * 60 * 1000;

  /**
   * The reported harm. Before this, `flockId ?? animalId` resolved to the group
   * and the animal held nothing — a false clear on milk.
   */
  it('holds for the animal it names, not only the group', () => {
    const active = activeWithdrawals([both], 'milk', ['animal-1'], now);

    expect(active).toHaveLength(1);
    expect(active[0]?.subjectId).toBe('animal-1');
  });

  it('holds for both when both are asked about', () => {
    const active = activeWithdrawals([both], 'milk', ['flock-1', 'animal-1'], now);

    expect(active.map((a) => a.subjectId).sort()).toEqual(['animal-1', 'flock-1']);
  });

  it('leaves an ordinary single-subject treatment exactly as it was', () => {
    const groupOnly: TreatmentRecord = { ...both, animalId: undefined };
    const active = activeWithdrawals([groupOnly], 'milk', ['flock-1', 'animal-1'], now);

    expect(active).toHaveLength(1);
    expect(active[0]?.subjectId).toBe('flock-1');
  });

  it('still says nothing once the window has cleared', () => {
    const cleared = 1_700_000_000_000 + 30 * 24 * 60 * 60 * 1000;
    expect(activeWithdrawals([both], 'milk', ['animal-1'], cleared)).toEqual([]);
  });
});
