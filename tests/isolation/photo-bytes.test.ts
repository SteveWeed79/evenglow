import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { UserDoc } from '@steading/api/db/identity';
import { startTestDb } from '../support/mongo';

/**
 * Tenancy, on the one surface where a leak is a picture.
 *
 * Every other isolation test here protects a row: a count, a date, a weight.
 * This protects an image of somebody's animals and somebody's yard, and a
 * photo id is a ULID that a determined person could enumerate. So the rule the
 * suite already holds the sync surface to — *another farm's document is a 404,
 * never a 403* — matters more here than anywhere, in both directions: reading
 * bytes and writing them.
 *
 * The bytes deliberately do not travel as mutations. Twenty-five megabytes of
 * JPEG in a JSON batch would blow the hundred-mutation cap into a request
 * nothing can retry sensibly, and one failed photo would take a morning's egg
 * tallies with it. That means this route does NOT inherit `scoped`'s guarantees
 * by construction the way an applier does — it has to check, and this is what
 * proves it does.
 */

const harness = await startTestDb('steading_photo_bytes');

if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'steading_photo_bytes';
}

const SECRET = 'a-test-secret-long-enough-for-hs256-abcdef';

const ORG_A = ulid();
const ORG_B = ulid();

const USERS = {
  ownerA: { _id: ulid(), orgId: ORG_A, role: 'owner' as const },
  ownerB: { _id: ulid(), orgId: ORG_B, role: 'owner' as const },
  handA: { _id: ulid(), orgId: ORG_A, role: 'hand' as const },
};

type TestUser = (typeof USERS)[keyof typeof USERS];

/** A tiny but genuine JPEG header, so nothing is parsing a random buffer. */
const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

async function buildApp() {
  const { buildServer } = await import('@steading/api/server');
  const { readEnv } = await import('@steading/api/env');
  return buildServer(
    readEnv({
      AUTH_SECRET: SECRET,
      MONGODB_URI: harness!.uri,
      MONGODB_DB: 'steading_photo_bytes',
      CORS_ORIGINS: 'https://app.test',
    }),
  );
}

async function tokenFor(user: TestUser): Promise<string> {
  const { mintAccessToken } = await import('@steading/api/auth/tokens');
  return mintAccessToken({ userId: user._id, orgId: user.orgId, role: user.role }, SECRET);
}

async function put(
  user: TestUser,
  id: string,
  bytes: Buffer = BYTES,
): Promise<{ status: number }> {
  const app = await buildApp();
  const res = await app.inject({
    method: 'PUT',
    url: `/photos/${id}`,
    headers: {
      authorization: `Bearer ${await tokenFor(user)}`,
      'content-type': 'image/jpeg',
    },
    payload: bytes,
  });
  await app.close();
  return { status: res.statusCode };
}

async function get(user: TestUser, id: string): Promise<{ status: number; body: Buffer }> {
  const app = await buildApp();
  const res = await app.inject({
    method: 'GET',
    url: `/photos/${id}`,
    headers: { authorization: `Bearer ${await tokenFor(user)}` },
  });
  await app.close();
  return { status: res.statusCode, body: res.rawPayload };
}

const users = () => harness!.db.collection<UserDoc>('users');
const photos = () => harness!.db.collection('photos');

/** The metadata record, which `/sync` would ordinarily have written. */
async function record(id: string, orgId: string, uploadedAt?: number): Promise<void> {
  await photos().insertOne({
    _id: id as never,
    orgId,
    subjectId: ulid(),
    contentType: 'image/jpeg',
    byteSize: BYTES.byteLength,
    capturedAt: Date.now(),
    ...(uploadedAt === undefined ? {} : { uploadedAt }),
  });
}

const describeDb = harness ? describe : describe.skip;

afterAll(async () => {
  await harness?.stop();
});

describeDb('photo bytes', () => {
  beforeEach(async () => {
    await users().deleteMany({});
    await photos().deleteMany({});
    await harness!.db.collection('photoBytes.files').deleteMany({});
    await harness!.db.collection('photoBytes.chunks').deleteMany({});

    await users().insertMany(
      Object.values(USERS).map((u) => ({
        _id: u._id,
        email: `${u._id}@example.test`,
        passwordHash: 'unused-in-this-suite',
        name: 'Test User',
        orgId: u.orgId,
        role: u.role,
        createdAt: new Date(),
      })) as never,
    );
  });

  describe('the ordinary path', () => {
    it('takes the bytes and gives them back', async () => {
      const id = ulid();
      await record(id, ORG_A);

      expect((await put(USERS.ownerA, id)).status).toBe(200);

      const got = await get(USERS.ownerA, id);
      expect(got.status).toBe(200);
      expect(got.body.equals(BYTES)).toBe(true);
    });

    /**
     * A client that timed out waiting for the answer to a successful upload
     * has to be able to try again. Twice is once, which is the same property
     * the mutation upsert gives the rest of the app.
     */
    it('is idempotent', async () => {
      const id = ulid();
      await record(id, ORG_A);

      await put(USERS.ownerA, id);
      expect((await put(USERS.ownerA, id)).status).toBe(200);

      // One revision on disk, not two. An accumulating store would fill a
      // disk with retries of a photo somebody took once.
      expect(await harness!.db.collection('photoBytes.files').countDocuments()).toBe(1);
      expect((await get(USERS.ownerA, id)).body.equals(BYTES)).toBe(true);
    });

    /**
     * The record syncs before the bytes do — that is the whole design, and it
     * means "no bytes yet" is an ordinary state rather than a fault.
     */
    it('answers 404 for a record whose bytes have not arrived', async () => {
      const id = ulid();
      await record(id, ORG_A);

      expect((await get(USERS.ownerA, id)).status).toBe(404);
    });
  });

  describe('another farm', () => {
    it('cannot read a photo it does not own — 404, never 403', async () => {
      const id = ulid();
      await record(id, ORG_A);
      await put(USERS.ownerA, id);

      const got = await get(USERS.ownerB, id);
      // 403 would confirm the id exists. Here the thing whose existence is
      // being confirmed is a picture of somebody's yard.
      expect(got.status).toBe(404);
      expect(got.body.equals(BYTES)).toBe(false);
    });

    /**
     * The write direction, which is the one that could overwrite rather than
     * merely disclose — a farm replacing another farm's evidence photo.
     */
    it('cannot write over a photo it does not own', async () => {
      const id = ulid();
      await record(id, ORG_A);
      await put(USERS.ownerA, id);

      expect((await put(USERS.ownerB, id, Buffer.from([0x00, 0x01]))).status).toBe(404);

      // And the original is exactly as it was.
      expect((await get(USERS.ownerA, id)).body.equals(BYTES)).toBe(true);
    });

    /**
     * The route's protection turns out to rest on something stronger than the
     * scoped filter, and it is worth pinning because it is easy to lose.
     *
     * This case was written to probe a subtler attack: org B creates its OWN
     * record under an id whose bytes org A already holds, so B's record lookup
     * succeeds and only the blob layer's org filter stands between them.
     *
     * That attack cannot be mounted. `_id` is unique across the whole
     * collection regardless of orgId, so the second insert is refused by the
     * database — which means no org can ever hold a record under another org's
     * photo id, and the record check alone is sufficient here.
     *
     * Asserted rather than assumed. If `photos` ever gained a compound key, or
     * ids stopped being globally minted ULIDs, this failing is the warning
     * that the route's tenancy now depends on the blob filter below instead.
     */
    it('cannot even record a photo under another farm’s id', async () => {
      const id = ulid();
      await record(id, ORG_A);
      await put(USERS.ownerA, id);

      await expect(record(id, ORG_B)).rejects.toThrow(/duplicate key/i);

      expect((await get(USERS.ownerB, id)).status).toBe(404);
      expect((await get(USERS.ownerA, id)).body.equals(BYTES)).toBe(true);
    });

    /**
     * The blob layer's own filter, tested where it can actually be reached.
     *
     * Unreachable through the route — see above — which is exactly why it is
     * worth a direct test. Defence in depth that nothing exercises is defence
     * nobody notices breaking, and `blobsFor` is a general API that a future
     * caller may reach without a record check in front of it.
     */
    it('will not hand one farm’s bytes to another, asked directly', async () => {
      const id = ulid();
      await record(id, ORG_A);
      await put(USERS.ownerA, id);

      const { blobsFor } = await import('@steading/api/db/blobs');

      expect(await (await blobsFor(ORG_B)).get(id)).toBeNull();
      expect(await (await blobsFor(ORG_B)).head(id)).toBeNull();
      expect(await (await blobsFor(ORG_A)).head(id)).not.toBeNull();
    });

    /**
     * And the destructive direction: a remove scoped to the wrong org must be
     * a no-op rather than a deletion, since nothing above it would notice.
     */
    it('will not delete one farm’s bytes on another’s behalf', async () => {
      const id = ulid();
      await record(id, ORG_A);
      await put(USERS.ownerA, id);

      const { blobsFor } = await import('@steading/api/db/blobs');
      await (await blobsFor(ORG_B)).remove(id);

      expect((await get(USERS.ownerA, id)).body.equals(BYTES)).toBe(true);
    });
  });

  describe('roles', () => {
    /**
     * The matrix lets a hand CREATE a photo and not UPDATE one, so gating
     * every upload on `update` would mean a hand takes a photo, its metadata
     * syncs, and its bytes are refused for ever — the record half of the
     * feature working and the byte half silently not.
     */
    it('lets a hand finish the photo it was allowed to take', async () => {
      const id = ulid();
      await record(id, ORG_A);

      expect((await put(USERS.handA, id)).status).toBe(200);
    });

    /**
     * The retry has to stay open. A client whose upload succeeded but whose
     * answer was lost has not set `uploadedAt` yet, and an upload that 403s on
     * the second attempt is one that can never finish.
     */
    it('lets a hand retry an upload whose answer was lost', async () => {
      const id = ulid();
      await record(id, ORG_A);

      await put(USERS.handA, id);
      expect((await put(USERS.handA, id)).status).toBe(200);
    });

    /** Replacing the image on an established photo is a genuine update. */
    it('will not let a hand replace an established photo', async () => {
      const id = ulid();
      await record(id, ORG_A, Date.now());
      await put(USERS.ownerA, id);

      expect((await put(USERS.handA, id, Buffer.from([0x00, 0x01]))).status).toBe(403);
      expect((await get(USERS.ownerA, id)).body.equals(BYTES)).toBe(true);
    });

    it('lets a hand read any photo on the farm', async () => {
      const id = ulid();
      await record(id, ORG_A);
      await put(USERS.ownerA, id);

      expect((await get(USERS.handA, id)).status).toBe(200);
    });
  });

  describe('signed out', () => {
    it('refuses both directions', async () => {
      const id = ulid();
      await record(id, ORG_A);

      const app = await buildApp();
      const read = await app.inject({ method: 'GET', url: `/photos/${id}` });
      const write = await app.inject({
        method: 'PUT',
        url: `/photos/${id}`,
        headers: { 'content-type': 'image/jpeg' },
        payload: BYTES,
      });
      await app.close();

      expect(read.statusCode).toBe(401);
      expect(write.statusCode).toBe(401);
    });
  });
});
