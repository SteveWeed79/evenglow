import { ulid } from 'ulid';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionClaims } from '@steading/api/auth/claims';
import type { UserDoc } from '@steading/api/db/identity';
import { scopedOn } from '@steading/api/db/scoped';
import { newId } from '@steading/contracts';
import { resetApiBase, setAccessToken, setApiBase } from '@steading/core/api';
import { flushOnce } from '@steading/core/sync/flush';
import { type PhotoBytes, setPhotoBytes, transferPhotos } from '@steading/core/sync/photos';
import { pullOnce } from '@steading/core/sync/pull';
import { enqueue } from '@steading/core/sync/queue';
import { listPhotos } from '@steading/core/read/photos';
import { type Device, type Farm, twoDevices } from '../support/devices';
import { startTestDb } from '../support/mongo';
import { type Wire, wireTo } from '../support/wire';

/**
 * A Farm Hand's photograph, from the phone that took it to the phone that did
 * not — the last of the six assertions the two-device harness was built for.
 *
 * ## Why this one needs both ends and the others did not
 *
 * P1-2 is the defect where *"the photo exists and is invisible"*. A hand may
 * `photo:create` and not `photo:update`, so the `uploadedAt` stamp that
 * `transferPhotos` enqueues after a successful upload was refused on the role
 * check — and `uploadedAt` is precisely what tells every other device that
 * there are bytes worth fetching. The record synced. The bytes reached the
 * server. **Nothing ever asked for them.**
 *
 * Its own verification note says why no existing test caught it: *"Tests cover
 * the optimistic local stamp and the hand's byte upload separately, so neither
 * fails."* Both halves passing while the feature does not work is the exact
 * shape a second device makes expressible, because the missing fact is one only
 * the second device ever reads.
 *
 * ## HTTP, unlike its sibling suites
 *
 * `wireTo` deliberately skips Fastify — the mutation assertions are about the
 * write path, and a JSON round trip between the test and the applier would only
 * add noise. Bytes are the opposite case. They **are** an HTTP surface: the
 * create-versus-update decision that P1-2 turns on lives in `routes/photos.ts`
 * and is keyed on the stored record, not on anything the applier sees. So the
 * mutations still go through `wireTo` and the bytes go through `app.inject`,
 * with `fetch` pointed at it — which is also the only way the role reaches the
 * route the way it does in life, re-derived from `users` rather than read off
 * the token (invariant 8).
 */

const harness = await startTestDb('steading_photo_round_trip');

if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'steading_photo_round_trip';
}

const describeDb = harness ? describe : describe.skip;

const SECRET = 'a-test-secret-long-enough-for-hs256-abcdef';
const ORG = ulid();

const HAND = { _id: ulid(), orgId: ORG, role: 'hand' as const };
const OWNER = { _id: ulid(), orgId: ORG, role: 'owner' as const };

const handClaims: SessionClaims = { userId: HAND._id, orgId: ORG, role: 'hand' };
const ownerClaims: SessionClaims = { userId: OWNER._id, orgId: ORG, role: 'owner' };

/** A tiny but genuine JPEG header, so nothing is parsing a random buffer. */
const IMAGE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
/** Visibly a different picture, for the replacement a hand must not manage. */
const OTHER_IMAGE = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66]);

function scope() {
  return scopedOn(harness!.db, ORG);
}

/**
 * The camera roll, as `PhotoBytes` describes it: whatever this handset happens
 * to be holding. One per device, because "which phone has the image" is the
 * fact the whole feature exists to change.
 */
function cameraRoll(): PhotoBytes & { ids(): string[] } {
  const held = new Map<string, Uint8Array>();
  return {
    has: (id) => held.has(id),
    read: async (id) => held.get(id) ?? null,
    write: async (id, value) => void held.set(id, value),
    ids: () => [...held.keys()],
  };
}

let app: Awaited<ReturnType<typeof buildApp>>;

async function buildApp() {
  const { buildServer } = await import('@steading/api/server');
  const { readEnv } = await import('@steading/api/env');
  return buildServer(
    readEnv({
      AUTH_SECRET: SECRET,
      MONGODB_URI: harness!.uri,
      MONGODB_DB: 'steading_photo_round_trip',
      CORS_ORIGINS: 'https://app.test',
    }),
  );
}

async function tokenFor(user: typeof HAND | typeof OWNER): Promise<string> {
  const { mintAccessToken } = await import('@steading/api/auth/tokens');
  return mintAccessToken({ userId: user._id, orgId: user.orgId, role: user.role }, SECRET);
}

/**
 * `fetch` pointed at the real routes.
 *
 * The headers are forwarded rather than rewritten, so the token
 * `transferPhotos` actually sends is the one the route actually checks — which
 * is the point, since the role is what P1-2 is about.
 */
const realFetch = globalThis.fetch;

function routeFetchToApp(): void {
  globalThis.fetch = (async (input: unknown, init: Record<string, unknown> = {}) => {
    const url = new URL(String(input));
    const res = await app.inject({
      method: (init.method as 'GET' | 'PUT') ?? 'GET',
      url: url.pathname,
      headers: (init.headers as Record<string, string>) ?? {},
      ...(init.body === undefined ? {} : { payload: Buffer.from(init.body as Uint8Array) }),
    });

    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      status: res.statusCode,
      arrayBuffer: async () =>
        res.rawPayload.buffer.slice(
          res.rawPayload.byteOffset,
          res.rawPayload.byteOffset + res.rawPayload.byteLength,
        ),
      json: async () => JSON.parse(res.body) as unknown,
    };
  }) as unknown as typeof globalThis.fetch;
}

let farm: Farm;
let handWire: Wire;
let ownerWire: Wire;
let handRoll: ReturnType<typeof cameraRoll>;
let ownerRoll: ReturnType<typeof cameraRoll>;

/**
 * Acting as one phone means its store, its camera roll and its token together
 * — three globals that describe the same handset, so setting one without the
 * others is a test measuring a device that does not exist.
 */
async function asPhone<T>(
  device: Device,
  roll: PhotoBytes,
  user: typeof HAND | typeof OWNER,
  work: () => Promise<T>,
): Promise<T> {
  return device.as(async () => {
    setPhotoBytes(roll);
    setAccessToken(await tokenFor(user));
    return work();
  });
}

beforeEach(async () => {
  app = await buildApp();
  routeFetchToApp();
  setApiBase('http://farm.test');

  for (const name of ['mutations', 'photos', 'users', 'photoBytes.files', 'photoBytes.chunks']) {
    await harness!.db.collection(name).deleteMany({});
  }
  await harness!.db.collection<UserDoc>('users').insertMany(
    [HAND, OWNER].map((u) => ({
      _id: u._id,
      email: `${u._id.toLowerCase()}@example.test`,
      passwordHash: 'unused-in-this-suite',
      name: 'Test User',
      orgId: u.orgId,
      role: u.role,
      createdAt: new Date(),
    })) as never,
  );

  farm = await twoDevices();
  handWire = wireTo(scope, handClaims);
  ownerWire = wireTo(scope, ownerClaims);
  handRoll = cameraRoll();
  ownerRoll = cameraRoll();
});

afterEach(async () => {
  await farm.close();
  setPhotoBytes(null);
  setAccessToken(null);
  resetApiBase();
  globalThis.fetch = realFetch;
  await app.close();
});

afterAll(async () => {
  await harness?.stop();
});

/** The hand photographs something and gets the record and the bytes up. */
async function theHandTakesAPhoto(subjectId: string): Promise<string> {
  const photo = newId();

  await asPhone(farm.a, handRoll, HAND, async () => {
    await handRoll.write(photo, IMAGE);
    await enqueue({
      entity: 'photo',
      op: 'create',
      targetId: photo,
      payload: {
        subjectId,
        contentType: 'image/jpeg',
        byteSize: IMAGE.byteLength,
        capturedAt: 1_700_000_000_000,
      },
    });
    await flushOnce(handWire.push);
    await transferPhotos();
    // The stamp is itself a mutation, so it needs the next flush to land.
    await flushOnce(handWire.push);
  });

  return photo;
}

describeDb('a photo a Farm Hand took', () => {
  it('reaches the other phone as an image, not as a record of one', async () => {
    const photo = await theHandTakesAPhoto(newId());

    // The stamp the hand's role used to forbid — without it the owner's phone
    // has no reason to ask for bytes, which is the whole of P1-2.
    const onServer = await harness!.db.collection('photos').findOne({ _id: photo as never });
    expect(onServer?.uploadedAt).toEqual(expect.any(Number));

    const downloaded = await asPhone(farm.b, ownerRoll, OWNER, async () => {
      await pullOnce(ownerWire.pull);
      return transferPhotos();
    });

    expect(downloaded.downloaded).toBe(1);
    expect(ownerRoll.ids()).toEqual([photo]);
    expect(await ownerRoll.read(photo)).toEqual(IMAGE);
  });

  /**
   * The half that makes the assertion above mean something. A device only
   * fetches bytes for a record whose `uploadedAt` is set, so a suite that
   * checked the download without checking what happens *without* the stamp
   * would pass on a build where the stamp was never needed.
   */
  it('is left on the phone that took it while the stamp is missing', async () => {
    const group = newId();
    const photo = newId();

    await asPhone(farm.a, handRoll, HAND, async () => {
      await handRoll.write(photo, IMAGE);
      await enqueue({
        entity: 'photo',
        op: 'create',
        targetId: photo,
        payload: {
          subjectId: group,
          contentType: 'image/jpeg',
          byteSize: IMAGE.byteLength,
          capturedAt: 1_700_000_000_000,
        },
      });
      // Flushed but never transferred: the record is up, the bytes are not.
      await flushOnce(handWire.push);
    });

    const outcome = await asPhone(farm.b, ownerRoll, OWNER, async () => {
      await pullOnce(ownerWire.pull);
      return transferPhotos();
    });

    // The owner's phone knows the photo exists and says so honestly.
    const known = await farm.b.as(() => listPhotos());
    expect(known.map((p) => p.id)).toEqual([photo]);
    expect(known[0]?.uploadedAt).toBeUndefined();

    expect(outcome.downloaded).toBe(0);
    expect(ownerRoll.ids()).toEqual([]);
  });

  /**
   * `canMutate` is unchanged, and this is what that sentence buys. The first
   * upload is the create being completed; a second one against a record that
   * already carries `uploadedAt` is a genuine update, and a hand may not.
   *
   * Asserted through the same `fetch` the app uses, so it is the route's own
   * decision rather than a restatement of the role table.
   */
  it('cannot be replaced by that hand once the farm has it', async () => {
    const photo = await theHandTakesAPhoto(newId());

    const replaced = await app.inject({
      method: 'PUT',
      url: `/photos/${photo}`,
      headers: {
        authorization: `Bearer ${await tokenFor(HAND)}`,
        'content-type': 'image/jpeg',
      },
      payload: Buffer.from(OTHER_IMAGE),
    });
    expect(replaced.statusCode).toBe(403);

    // And the owner still gets the picture that was actually taken.
    await asPhone(farm.b, ownerRoll, OWNER, async () => {
      await pullOnce(ownerWire.pull);
      await transferPhotos();
    });
    expect(await ownerRoll.read(photo)).toEqual(IMAGE);
  });

  /** An owner replacing it is the update the role table does allow. */
  it('can be replaced by an owner', async () => {
    const photo = await theHandTakesAPhoto(newId());

    const replaced = await app.inject({
      method: 'PUT',
      url: `/photos/${photo}`,
      headers: {
        authorization: `Bearer ${await tokenFor(OWNER)}`,
        'content-type': 'image/jpeg',
      },
      payload: Buffer.from(OTHER_IMAGE),
    });
    expect(replaced.statusCode).toBe(200);

    await asPhone(farm.b, ownerRoll, OWNER, async () => {
      await pullOnce(ownerWire.pull);
      await transferPhotos();
    });
    expect(await ownerRoll.read(photo)).toEqual(OTHER_IMAGE);
  });
});
