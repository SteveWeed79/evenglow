import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';
import type { SessionClaims } from '@steading/api/auth/claims';
import { scopedOn } from '@steading/api/db/scoped';
import { applyBatch } from '@steading/api/sync/apply';
import { makeMutation } from '../support/fixtures';

/**
 * The role gate on a hand's photo stamp, with no mongod present.
 *
 * The rule has two halves and they live in different files: `isUploadStamp`
 * decides what the mutation is, `decideProjection` decides whether this photo
 * is still waiting for it. Each half has a pure test of its own — but the line
 * that COMBINES them is in `applyMutation`, and a pure test of either half
 * would go on passing if that line were wrong.
 *
 * So the applier is driven directly against a fake `Db`, the way
 * `scoped.test.ts` drives the guard layer. It costs a small fake and it means
 * the fix is proven here rather than only in the CI job that has a database.
 */

const ORG = 'org-a';
const HAND: SessionClaims = { userId: 'user-hand', orgId: ORG, role: 'hand' };
const OWNER: SessionClaims = { userId: 'user-owner', orgId: ORG, role: 'owner' };

/**
 * Enough Mongo to run one mutation through: the log upsert reports a first
 * insert, and the photo collection hands back whatever the test set up.
 */
function fakeDb(photo: Record<string, unknown> | null): { db: Db; sets: unknown[] } {
  const sets: unknown[] = [];

  const collection = (name: string) => ({
    findOne: () => Promise.resolve(name === 'photos' ? photo : null),
    find: () => ({ limit: () => ({ sort: () => ({ toArray: () => Promise.resolve([]) }) }) }),
    countDocuments: () => Promise.resolve(0),
    insertOne: () => Promise.resolve({ acknowledged: true }),
    updateOne: (_filter: unknown, update: Record<string, unknown>) => {
      if (name === 'photos') sets.push(update.$set);
      return Promise.resolve({ upsertedCount: 1 });
    },
    deleteOne: () => Promise.resolve({ deletedCount: 1 }),
  });

  return { db: { collection } as unknown as Db, sets };
}

function stamp(payload: Record<string, unknown>) {
  return makeMutation({ entity: 'photo', op: 'update', payload });
}

async function run(
  claims: SessionClaims,
  payload: Record<string, unknown>,
  photo: Record<string, unknown> | null = { _id: 'photo-1' },
) {
  const { db, sets } = fakeDb(photo);
  const [result] = await applyBatch(scopedOn(db, ORG), claims, [stamp(payload)]);
  return { result, sets };
}

describe('a hand stamping a photo upload', () => {
  it('is let past the role gate', async () => {
    const { result, sets } = await run(HAND, { uploadedAt: 1_700_000_000_000 });

    expect(result?.status).toBe('applied');
    // And it actually reached the projection, rather than merely not being
    // refused.
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ uploadedAt: 1_700_000_000_000 });
  });

  /**
   * The narrowing, at the gate rather than in the predicate. This is the line
   * that would silently widen a hand's rights if the `&&` were an `||`, or if
   * the exception were dropped into `canMutate` instead.
   */
  it('is refused when anything travels beside the stamp', async () => {
    const smuggled = await run(HAND, { uploadedAt: 1, caption: 'mine now' });
    expect(smuggled.result?.status).toBe('rejected');
    expect(smuggled.sets).toEqual([]);

    const captionOnly = await run(HAND, { caption: 'mine now' });
    expect(captionOnly.result?.status).toBe('rejected');
    expect(captionOnly.sets).toEqual([]);
  });

  it('is refused once the photo already has its bytes', async () => {
    const { result, sets } = await run(HAND, { uploadedAt: 2 }, {
      _id: 'photo-1',
      uploadedAt: 1_700_000_000_000,
    });

    expect(result?.status).toBe('rejected');
    expect(sets).toEqual([]);
  });

  it('is still refused on a photo this farm does not have', async () => {
    const { result } = await run(HAND, { uploadedAt: 1 }, null);
    expect(result?.status).toBe('conflict');
  });

  it('leaves the rest of a hand\'s photo rights alone', async () => {
    const removed = makeMutation({ entity: 'photo', op: 'delete', payload: {} });
    const { db } = fakeDb({ _id: 'photo-1' });
    const [result] = await applyBatch(scopedOn(db, ORG), HAND, [removed]);

    expect(result?.status).toBe('rejected');
  });

  it('does not narrow an owner', async () => {
    const { result, sets } = await run(OWNER, { caption: 'south gate' }, {
      _id: 'photo-1',
      uploadedAt: 1_700_000_000_000,
    });

    expect(result?.status).toBe('applied');
    expect(sets[0]).toMatchObject({ caption: 'south gate' });
  });
});
