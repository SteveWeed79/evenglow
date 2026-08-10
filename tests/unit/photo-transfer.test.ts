import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@steading/contracts';
import { resetApiBase, setAccessToken, setApiBase } from '@steading/core/api';
import { listPhotos } from '@steading/core/read/photos';
import { setPhotoBytes, transferPhotos } from '@steading/core/sync/photos';
import { localStore } from '@steading/core/db/store';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';

/**
 * Getting a photo's bytes to the server, and back to a second phone.
 *
 * The tenancy half lives in `tests/isolation/photo-bytes.test.ts`, against a
 * real database. This is the client half, which is where the offline-first
 * awkwardness is: a record that syncs before its bytes, a device that holds
 * the record and not the image, an upload that succeeded but whose answer
 * never came back.
 *
 * The rule under all of it: **nothing here may throw.** A photo failing to
 * move is an ordinary condition — a barn, a tunnel, a server restart — and it
 * must not reach a screen as an error or disturb a flush that is otherwise
 * fine.
 */

const SUBJECT = newId();
const PIXELS = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

let sent: { url: string; method: string }[] = [];

/** The device's files: what this phone actually holds. */
let files: Map<string, Uint8Array>;

function device(): void {
  setPhotoBytes({
    has: (id) => files.has(id),
    read: async (id) => files.get(id) ?? null,
    write: async (id, bytes) => {
      files.set(id, bytes);
    },
  });
}

function server(options: { status?: number; body?: Uint8Array } = {}): void {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit): Promise<Response> => {
    sent.push({ url, method: init?.method ?? 'GET' });

    const status = options.status ?? 200;
    if (status !== 200) return new Response(null, { status });

    return new Response((options.body ?? PIXELS) as BodyInit, { status: 200 });
  });
}

/**
 * A photo record, as `/sync` and the capture screen would have written it —
 * and then acknowledged, because the bytes are not offered until it has been.
 *
 * **The acknowledgement is the point rather than test scaffolding.** A PUT for
 * a photo the server has never heard of is a 404, so the transfer waits until
 * that record is off this device. It used to wait for the WHOLE outbox to
 * empty, which was sufficient and far too blunt: a farm that was behind never
 * emptied it and therefore never uploaded a picture. The gate is per photo
 * now, so a test that wants an upload has to do what a real device does and
 * get the record acknowledged first.
 */
async function photo(id: string, uploadedAt?: number, sent = true): Promise<void> {
  const queued = await enqueue({
    entity: 'photo',
    op: 'create',
    targetId: id,
    payload: {
      subjectId: SUBJECT,
      contentType: 'image/jpeg',
      byteSize: PIXELS.byteLength,
      capturedAt: Date.now(),
      ...(uploadedAt === undefined ? {} : { uploadedAt }),
    },
  });

  if (sent) await localStore().resolveBatch([queued], [{ id: queued.id, status: 'applied' }]);
}

beforeEach(async () => {
  await freshStore();
  files = new Map();
  sent = [];
  setApiBase('https://farm.example');
  setAccessToken('a-token');
  device();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetApiBase();
  setAccessToken(null);
  setPhotoBytes(null);
});

describe('sending what this device has', () => {
  it('uploads a photo the server does not have', async () => {
    const id = newId();
    await photo(id);
    files.set(id, PIXELS);
    server();

    const moved = await transferPhotos();

    expect(moved.uploaded).toBe(1);
    expect(sent[0]?.method).toBe('PUT');
    expect(sent[0]?.url).toBe(`https://farm.example/photos/${id}`);
  });

  /**
   * The trick that makes this work without a second status channel: "the
   * server has this photo" becomes an ordinary synced record, so the farm's
   * other devices learn it through machinery that already exists.
   */
  it('records the upload as a mutation, so other devices find out', async () => {
    const id = newId();
    await photo(id);
    files.set(id, PIXELS);
    server();

    await transferPhotos();

    const [stored] = await listPhotos();
    expect(stored?.uploadedAt).toBeGreaterThan(0);
  });

  it('does not upload one that is already up', async () => {
    const id = newId();
    await photo(id, Date.now());
    files.set(id, PIXELS);
    server();

    expect((await transferPhotos()).uploaded).toBe(0);
    expect(sent).toHaveLength(0);
  });

  /**
   * A record whose bytes live on somebody else's phone is not this device's
   * to upload. Trying would send nothing and mark it done.
   */
  it('does not upload a record whose bytes it does not hold', async () => {
    await photo(newId());
    server();

    expect((await transferPhotos()).uploaded).toBe(0);
    expect(sent).toHaveLength(0);
  });

  /**
   * The ordinary first-sync race: the metadata is in the same flush this
   * transfer is chasing, so the server has not heard of the photo yet.
   */
  it('leaves a 404 pending rather than marking it done', async () => {
    const id = newId();
    await photo(id);
    files.set(id, PIXELS);
    server({ status: 404 });

    const moved = await transferPhotos();

    expect(moved.uploaded).toBe(0);
    expect(moved.pending).toBe(1);
    // Critically NOT stamped: a photo the server refused must be retried.
    expect((await listPhotos())[0]?.uploadedAt).toBeUndefined();
  });

  it('survives being offline without throwing', async () => {
    const id = newId();
    await photo(id);
    files.set(id, PIXELS);
    vi.stubGlobal('fetch', async () => {
      throw new Error('Network request failed');
    });

    await expect(transferPhotos()).resolves.toMatchObject({ uploaded: 0, pending: 1 });
    expect((await listPhotos())[0]?.uploadedAt).toBeUndefined();
  });
});

describe('fetching what this device is missing', () => {
  it('downloads a photo taken on another phone', async () => {
    const id = newId();
    await photo(id, Date.now());
    server();

    const moved = await transferPhotos();

    expect(moved.downloaded).toBe(1);
    expect(sent[0]?.method).toBe('GET');
    expect(files.get(id)).toEqual(PIXELS);
  });

  /**
   * `uploadedAt` says the bytes exist and the server disagrees. Nothing to
   * retry into — and the gallery already says this device does not have the
   * image, which stays true.
   */
  it('does not write anything when the server has no bytes', async () => {
    const id = newId();
    await photo(id, Date.now());
    server({ status: 404 });

    expect((await transferPhotos()).downloaded).toBe(0);
    expect(files.has(id)).toBe(false);
  });

  it('does not write an empty body', async () => {
    const id = newId();
    await photo(id, Date.now());
    server({ body: new Uint8Array(0) });

    expect((await transferPhotos()).downloaded).toBe(0);
    expect(files.has(id)).toBe(false);
  });
});

describe('a build with nowhere to put an image', () => {
  /**
   * Core compiles for a server too. One that never supplies a byte store must
   * move nothing, silently — not fail, and not reach for a filesystem it has
   * no business assuming.
   */
  it('does nothing at all', async () => {
    setPhotoBytes(null);
    await photo(newId());
    server();

    expect(await transferPhotos()).toEqual({ uploaded: 0, downloaded: 0, pending: 0 });
    expect(sent).toHaveLength(0);
  });
});

describe('a farm with a backlog', () => {
  /**
   * A phone handed over with two hundred photos on it must not spend its
   * first morning uploading them before anything else syncs.
   */
  it('moves a few at a time and says how many are left', async () => {
    for (let i = 0; i < 8; i += 1) {
      const id = newId();
      await photo(id);
      files.set(id, PIXELS);
    }
    server();

    const moved = await transferPhotos();

    expect(moved.uploaded).toBe(5);
    expect(moved.pending).toBe(3);
  });
});


/**
 * The half that was silently broken, and the reason a picture went missing.
 *
 * `movePhotos` ran only on the idle tick, which needs an empty outbox. A farm
 * held on 402, or simply behind on a bad connection, never empties one — so
 * the devices whose pictures were most at risk were exactly the devices that
 * never uploaded any, while `PUT /photos/:id` sat there ungated, willing to
 * take them the whole time.
 */
describe('a farm that is behind', () => {
  it('still sends a photo whose own record has landed', async () => {
    server();
    const id = newId();
    await photo(id);
    files.set(id, PIXELS);

    // Something else entirely, still waiting to go. The old gate refused every
    // photo on the strength of this one row.
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now(), flockId: SUBJECT, count: 12 },
    });

    const moved = await transferPhotos();
    expect(moved.uploaded).toBe(1);
  });

  it('holds back a photo whose own record has not', async () => {
    server();
    // Enqueued and never acknowledged: the server has no record to attach
    // bytes to, so a PUT would be a 404.
    const id = newId();
    await photo(id, undefined, false);
    files.set(id, PIXELS);

    const moved = await transferPhotos();
    expect(moved.uploaded).toBe(0);
  });
});
