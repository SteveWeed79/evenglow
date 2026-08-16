import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionClaims } from '@steading/api/auth/claims';
import { scopedOn } from '@steading/api/db/scoped';
import { applyBatch } from '@steading/api/sync/apply';
import { makeMutation } from '../support/fixtures';
import { startTestDb } from '../support/mongo';

/**
 * Clearing a field, on the half of the journey that used to lose it.
 *
 * The device was never the problem. `TreatmentScreen`'s established fix — name
 * every optional field, with `undefined` where it is now absent — cleared the
 * local projection exactly right and then vanished: `JSON.stringify` drops an
 * `undefined` value, so the mutation arrived here without the key and `$set`
 * left the old value standing. The handset read cleared, the server read
 * unchanged, and the next snapshot put it back.
 *
 * So a cleared field is `null` on the wire now (`contracts/clearing.ts`), and
 * these are the assertions that it becomes an absence in the document rather
 * than a null sitting in it — which would be the same bug wearing a different
 * hat, since every reader parses that document against a schema where an
 * optional field takes a value or nothing.
 */

const harness = await startTestDb('steading_clearing');
const describeDb = harness ? describe : describe.skip;

const ORG_A = ulid();
const ORG_B = ulid();

const OWNER: SessionClaims = { userId: ulid(), orgId: ORG_A, role: 'owner' };
const OWNER_B: SessionClaims = { userId: ulid(), orgId: ORG_B, role: 'owner' };

function scope(orgId: string = ORG_A) {
  return scopedOn(harness!.db, orgId);
}

const FLOCK = () => ulid();

function aFlock(targetId: string) {
  return makeMutation({
    entity: 'flock',
    op: 'create',
    targetId,
    payload: {
      name: 'The broilers',
      species: 'chicken',
      count: 20,
      breedId: 'australorp',
      bornAt: 1_700_000_000_000,
    },
  });
}

async function storedFlock(targetId: string, orgId: string = ORG_A) {
  return harness!.db.collection('flocks').findOne({ _id: targetId as never, orgId });
}

afterAll(async () => {
  await harness?.stop();
});

describeDb('a null in an update', () => {
  beforeEach(async () => {
    await harness!.db.collection('mutations').deleteMany({});
    await harness!.db.collection('flocks').deleteMany({});
  });

  it('removes the field instead of storing a null', async () => {
    const id = FLOCK();
    await applyBatch(scope(), OWNER, [aFlock(id)]);

    const result = await applyBatch(scope(), OWNER, [
      makeMutation({ entity: 'flock', op: 'update', targetId: id, payload: { breedId: null } }),
    ]);

    expect(result[0]?.status).toBe('applied');

    const doc = await storedFlock(id);
    expect(doc).not.toBeNull();
    expect(doc).not.toHaveProperty('breedId');
    expect(doc?.name).toBe('The broilers');
    expect(doc?.count).toBe(20);
  });

  it('sets and clears in one mutation', async () => {
    const id = FLOCK();
    await applyBatch(scope(), OWNER, [aFlock(id)]);

    await applyBatch(scope(), OWNER, [
      makeMutation({
        entity: 'flock',
        op: 'update',
        targetId: id,
        payload: { count: 18, breedId: null },
      }),
    ]);

    const doc = await storedFlock(id);
    expect(doc?.count).toBe(18);
    expect(doc).not.toHaveProperty('breedId');
  });

  /** A3: the same clear applied twice is one record and the same document. */
  it('is idempotent on replay', async () => {
    const id = FLOCK();
    await applyBatch(scope(), OWNER, [aFlock(id)]);

    const clear = makeMutation({
      entity: 'flock',
      op: 'update',
      targetId: id,
      payload: { bornAt: null },
    });

    const first = await applyBatch(scope(), OWNER, [clear]);
    const replay = await applyBatch(scope(), OWNER, [clear]);

    expect(first[0]?.status).toBe('applied');
    expect(replay[0]?.status).toBe('duplicate');
    expect(await harness!.db.collection('mutations').countDocuments({ targetId: id })).toBe(2);

    const doc = await storedFlock(id);
    expect(doc).not.toHaveProperty('bornAt');
  });

  /**
   * The clear is in the log, so a device rebuilding from zero gets it. That is
   * what makes the fix reach the farm's *other* handsets rather than only the
   * one that pressed the button.
   */
  it('is stored in the mutation log as a null', async () => {
    const id = FLOCK();
    await applyBatch(scope(), OWNER, [aFlock(id)]);

    const clear = makeMutation({
      entity: 'flock',
      op: 'update',
      targetId: id,
      payload: { breedId: null },
    });
    await applyBatch(scope(), OWNER, [clear]);

    const logged = await harness!.db.collection('mutations').findOne({ _id: clear.id as never });
    expect(logged?.payload).toEqual({ breedId: null });
  });

  it('leaves an ordinary edit alone, with no $unset in it', async () => {
    const id = FLOCK();
    await applyBatch(scope(), OWNER, [aFlock(id)]);

    // An empty `$unset` is an error in Mongo, so the plain path must not build
    // one — this is every edit on the farm, and it would fail on all of them.
    const result = await applyBatch(scope(), OWNER, [
      makeMutation({ entity: 'flock', op: 'update', targetId: id, payload: { count: 21 } }),
    ]);

    expect(result[0]?.status).toBe('applied');
    const doc = await storedFlock(id);
    expect(doc?.count).toBe(21);
    expect(doc?.breedId).toBe('australorp');
  });

  /**
   * A clear that would leave the record invalid is refused, and this is the
   * reason `mergedUpdateProblem` reads null as absent: the merge it checks is
   * `{ ...stored, ...payload }`, where the field being cleared shows up as null
   * rather than as gone.
   */
  it('refuses a clear that would leave a schedule with no trigger', async () => {
    const machine = ulid();
    const service = ulid();

    await applyBatch(scope(), OWNER, [
      makeMutation({
        entity: 'equipment',
        op: 'create',
        targetId: machine,
        payload: { name: 'The tractor' },
      }),
      makeMutation({
        entity: 'maintenance',
        op: 'create',
        targetId: service,
        payload: { equipmentId: machine, title: 'Oil and filter', intervalHours: 100 },
      }),
    ]);

    const result = await applyBatch(scope(), OWNER, [
      makeMutation({
        entity: 'maintenance',
        op: 'update',
        targetId: service,
        payload: { intervalHours: null },
      }),
    ]);

    expect(result[0]?.status).toBe('rejected');

    const doc = await harness!.db
      .collection('maintenance')
      .findOne({ _id: service as never, orgId: ORG_A });
    expect(doc?.intervalHours).toBe(100);
  });

  it('refuses a null on a create, where there is nothing to remove', async () => {
    const id = FLOCK();

    const result = await applyBatch(scope(), OWNER, [
      makeMutation({
        entity: 'flock',
        op: 'create',
        targetId: id,
        payload: { name: 'The hens', species: 'chicken', count: 6, breedId: null },
      }),
    ]);

    expect(result[0]?.status).toBe('rejected');
    expect(await storedFlock(id)).toBeNull();
  });

  /**
   * Tenancy, because this is a new shape on the write path: a clear aimed at
   * another farm's record is a 404-shaped refusal and touches nothing.
   */
  it('cannot clear a field on another farm’s record', async () => {
    const id = FLOCK();
    await applyBatch(scope(), OWNER, [aFlock(id)]);

    const result = await applyBatch(scope(ORG_B), OWNER_B, [
      makeMutation({ entity: 'flock', op: 'update', targetId: id, payload: { breedId: null } }),
    ]);

    expect(result[0]?.status).toBe('conflict');

    const doc = await storedFlock(id);
    expect(doc?.breedId).toBe('australorp');
  });
});
