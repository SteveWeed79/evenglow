import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionClaims } from '@homefarm/api/auth/claims';
import { scopedOn } from '@homefarm/api/db/scoped';
import { applyBatch } from '@homefarm/api/sync/apply';
import { readSnapshotPage } from '@homefarm/api/sync/snapshot';
import { makeMutation } from '../support/fixtures';
import { startTestDb } from '../support/mongo';

/**
 * A Farm Hand finishing a photo, end to end on the write path.
 *
 * The bug this pins: `photo:create` let a hand take a photo and
 * `routes/photos.ts` let the bytes up, but the client then enqueues a
 * `photo:update` stamping `uploadedAt` and the role matrix refused it. So the
 * record synced, the bytes landed, and the field that tells every OTHER device
 * the image exists was never set — `sync/photos.ts` only offers a photo for
 * download once `uploadedAt` is present. The photo was on the server and
 * invisible to the farm, and the hand collected an inbox entry they could do
 * nothing about.
 *
 * Asserted through the feed rather than only the projection, because a stamp
 * the other devices never receive would fix nothing.
 */

const harness = await startTestDb('homefarm_photo_stamp');
const describeDb = harness ? describe : describe.skip;

const ORG = ulid();
const HAND: SessionClaims = { userId: ulid(), orgId: ORG, role: 'hand' };
const OWNER: SessionClaims = { userId: ulid(), orgId: ORG, role: 'owner' };

function scope() {
  return scopedOn(harness!.db, ORG);
}

function photoCreate(targetId: string) {
  return makeMutation({
    targetId,
    entity: 'photo',
    op: 'create',
    payload: {
      subjectId: ulid(),
      contentType: 'image/jpeg',
      byteSize: 42_000,
      capturedAt: 1_700_000_000_000,
    },
  });
}

function stamp(targetId: string, at = 1_700_000_001_000) {
  return makeMutation({
    targetId,
    entity: 'photo',
    op: 'update',
    payload: { uploadedAt: at },
  });
}

/** What a second device would receive. */
async function feed(): Promise<string[]> {
  const page = await readSnapshotPage(scope(), { since: 0, sinceId: null });
  return page.mutations.map((m) => m.id);
}

async function photo(id: string) {
  return harness!.db.collection('photos').findOne({ _id: id as never });
}

afterAll(async () => {
  await harness?.stop();
});

describeDb('a hand finishing a photo', () => {
  beforeEach(async () => {
    await harness!.db.collection('mutations').deleteMany({});
    await harness!.db.collection('photos').deleteMany({});
  });

  it('may stamp the upload it has just made', async () => {
    const targetId = ulid();
    const created = photoCreate(targetId);
    const stamped = stamp(targetId);

    const results = await applyBatch(scope(), HAND, [created, stamped]);

    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);
    expect((await photo(targetId))?.uploadedAt).toBe(1_700_000_001_000);
  });

  /**
   * The half that actually fixes the reported symptom. Without the stamp
   * reaching the feed, every other phone still has a photo record with no
   * `uploadedAt` and never asks for the bytes.
   */
  it('sends the stamp on to every other device', async () => {
    const targetId = ulid();
    const created = photoCreate(targetId);
    const stamped = stamp(targetId);

    await applyBatch(scope(), HAND, [created, stamped]);

    expect(await feed()).toEqual([created.id, stamped.id]);
  });

  /**
   * The narrowing. An upload stamp is a completion, not a licence to edit —
   * a hand must not smuggle a caption or a re-linked subject through on the
   * back of one.
   */
  it('may not carry anything else through on the stamp', async () => {
    const targetId = ulid();
    await applyBatch(scope(), HAND, [photoCreate(targetId)]);

    const smuggled = makeMutation({
      targetId,
      entity: 'photo',
      op: 'update',
      payload: { uploadedAt: 1_700_000_001_000, caption: 'mine now' },
    });
    const captionOnly = makeMutation({
      targetId,
      entity: 'photo',
      op: 'update',
      payload: { caption: 'mine now' },
    });

    const results = await applyBatch(scope(), HAND, [smuggled, captionOnly]);

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect((await photo(targetId))?.caption).toBeUndefined();
    expect((await photo(targetId))?.uploadedAt).toBeUndefined();
  });

  /**
   * Completing an upload is theirs to finish; a photo that already has bytes
   * is not theirs to touch. Refused at the projection, which is the only place
   * that can see the record.
   */
  it('may not re-stamp a photo that is already uploaded', async () => {
    const targetId = ulid();
    await applyBatch(scope(), HAND, [photoCreate(targetId), stamp(targetId)]);

    const again = await applyBatch(scope(), HAND, [stamp(targetId, 1_900_000_000_000)]);

    expect(again[0]?.status).toBe('rejected');
    expect((await photo(targetId))?.uploadedAt).toBe(1_700_000_001_000);
  });

  /** And a refusal must not reach the other devices — the outcome filter's job. */
  it('withholds the refused re-stamp from the feed', async () => {
    const targetId = ulid();
    const created = photoCreate(targetId);
    const first = stamp(targetId);
    await applyBatch(scope(), HAND, [created, first]);

    const again = stamp(targetId, 1_900_000_000_000);
    await applyBatch(scope(), HAND, [again]);

    expect(await feed()).toEqual([created.id, first.id]);
  });

  it('leaves an owner free to change a photo at any point', async () => {
    const targetId = ulid();
    await applyBatch(scope(), OWNER, [photoCreate(targetId), stamp(targetId)]);

    const edited = makeMutation({
      targetId,
      entity: 'photo',
      op: 'update',
      payload: { caption: 'south gate' },
    });
    const result = await applyBatch(scope(), OWNER, [edited]);

    expect(result[0]?.status).toBe('applied');
    expect((await photo(targetId))?.caption).toBe('south gate');
  });

  /** The rest of the matrix is untouched: a hand still cannot remove a photo. */
  it('still refuses a hand removing a photo', async () => {
    const targetId = ulid();
    await applyBatch(scope(), OWNER, [photoCreate(targetId)]);

    const removed = makeMutation({ targetId, entity: 'photo', op: 'delete', payload: {} });
    const result = await applyBatch(scope(), HAND, [removed]);

    expect(result[0]?.status).toBe('rejected');
    expect((await photo(targetId))?.archivedAt).toBeUndefined();
  });
});
