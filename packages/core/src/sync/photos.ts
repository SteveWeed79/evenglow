import { photoUrl, syncHeaders } from '../api';
import { localStore } from '../db/store';
import { listPhotos } from '../read/photos';
import { enqueue } from './queue';

/**
 * Getting a photo's bytes to the server, and back to a second phone.
 *
 * ## The half `photoShape` promised
 *
 * *"Metadata only — the Blob is uploaded separately, which is why
 * `uploadedAt` is optional: the record syncs before the bytes do."* The record
 * half has worked for months; a second device sees that a photo exists and the
 * gallery says honestly that this phone does not have the image. This is the
 * rest, and it is additive exactly as that note predicted.
 *
 * ## Bytes are a transfer, not a mutation
 *
 * Everything else this app writes goes through the envelope. A photo cannot:
 * twenty-five megabytes in a JSON batch would blow the hundred-mutation cap
 * into a request nothing can retry sensibly, and one failed photo would take a
 * morning's egg tallies down with it.
 *
 * So this runs BESIDE the flush and never inside it. It is called after a
 * successful flush rather than before one, because the metadata record has to
 * reach the server before the bytes have anything to attach to — a PUT for a
 * photo the server has never heard of is a 404, correctly.
 *
 * ## The completion is itself a record
 *
 * When bytes land, this enqueues an ordinary `photo:update` setting
 * `uploadedAt`. That is deliberate and it is the whole trick: "the server has
 * this photo" becomes a synced fact, so the farm's other devices learn it
 * through the machinery that already exists rather than through a second
 * status channel that would have to be kept in step.
 *
 * ## One at a time, like the flush
 *
 * Sequential for the same reason `flushOnce` is: a farm on a barn's worth of
 * signal does better with one request finishing than six competing, and a
 * failure part-way leaves a state that is easy to describe.
 */

/**
 * Where the bytes actually live, supplied by the platform.
 *
 * `packages/core` compiles for a server as well as a handset and cannot import
 * `expo-file-system`, so this follows the pattern `setApiBase`,
 * `setAccessToken` and the SQL driver already use: core states the shape and
 * the app hands one in.
 *
 * A build that never sets one uploads nothing and downloads nothing, silently
 * — which is right, because a build with nowhere to put an image has nothing
 * useful to do with one.
 */
export interface PhotoBytes {
  /** Whether this device holds the image for a record it can see. */
  has(id: string): boolean | Promise<boolean>;
  read(id: string): Promise<Uint8Array | null>;
  write(id: string, bytes: Uint8Array): Promise<void>;
}

let bytes: PhotoBytes | null = null;

export function setPhotoBytes(store: PhotoBytes | null): void {
  bytes = store;
}

export interface TransferResult {
  uploaded: number;
  downloaded: number;
  /** Left for the next attempt — offline, or a server that was not ready. */
  pending: number;
}

const NOTHING: TransferResult = { uploaded: 0, downloaded: 0, pending: 0 };

/**
 * How many photos to move in one pass.
 *
 * A farm that has just been given a phone with two hundred photos on it must
 * not spend its first morning uploading them before anything else syncs. The
 * next pass takes the next few, and the passes are frequent.
 */
const PER_PASS = 5;

let inFlight: Promise<TransferResult> | null = null;

/**
 * Sends what this device has and the server does not, then fetches what the
 * server has and this device does not.
 *
 * Never throws. A transfer failing is an ordinary condition — a barn, a
 * tunnel, a server restart — and nothing here may reach a screen as an error
 * or stop a flush that is otherwise fine.
 *
 * ## Single-flight, like every other pass that spans a round trip
 *
 * `flushOnce`, `pullOnce` and `refreshSession` are each single-flight and each
 * says why. This was not, and it is the one the engine can genuinely run twice:
 * `nudge()` calls `schedule(0)` whether or not a tick is already mid-await, so
 * a resume or a network regain landing during a tick starts a second one. That
 * tick's `pull` and `flush` are caught by their own guards. `movePhotos` was
 * the hole they left.
 *
 * Two passes read `listPhotos()` before either enqueues an `uploadedAt`, so
 * both build the same `toUpload` list and **PUT the same JPEGs twice** — up to
 * five of them, on the connection a barn has, which is the expensive half of
 * everything this module does. Both then enqueue a `photo:update` for the same
 * field: harmless to the record, and two more rows behind the number a farm
 * reads as work waiting. Downloads double the same way, fetched twice and
 * written to the store twice.
 *
 * **The tick itself is left re-entrant, deliberately.** A guard there would
 * have to either drop the nudge — losing the "go now" a farmer walking back
 * into signal just earned — or reschedule at zero, which spins for as long as
 * the first tick runs. Sharing the in-flight promise costs neither: the second
 * caller gets the first pass's answer, which is the true one.
 */
export function transferPhotos(): Promise<TransferResult> {
  inFlight ??= runTransfer().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runTransfer(): Promise<TransferResult> {
  const store = bytes;
  if (store === null) return NOTHING;

  const photos = await listPhotos();
  let uploaded = 0;
  let downloaded = 0;
  let pending = 0;

  /**
   * Records this device still owes the server, so a photo is offered only once
   * its own record has landed.
   *
   * **This replaces "the whole outbox is empty" as the safety condition**, and
   * the swap is what lets photos move at all on a farm that is behind. A PUT
   * for a photo the server has never heard of is a 404 — that is the real
   * constraint, and it is about ONE record. An empty queue was a proxy for it:
   * cheap, always sufficient, and never satisfied on the farms that most need
   * their pictures off the handset.
   *
   * Knowing this per photo is newly possible. Acknowledged rows used to be
   * deleted, so "absent from the outbox" meant applied OR never written;
   * invariant 7 keeps them as `applied`, so a row that is still `queued` or
   * `sending` is now a positive fact rather than an inference.
   *
   * `rejected` is deliberately not owed. That record is never going to land,
   * so waiting on it would hold the bytes for ever; the PUT 404s once, costs
   * one request, and the photo stays exactly where it is.
   */
  const owed = new Set(
    (await localStore().readOutboxBySeq())
      .filter((mutation) => mutation.status === 'queued' || mutation.status === 'sending')
      .map((mutation) => mutation.targetId),
  );

  /**
   * Newest first, which is what `listPhotos` already gives.
   *
   * The photo somebody took this morning is the one they might want on the
   * other phone this afternoon. A backlog of last year's receipts can wait,
   * and with a per-pass cap the order is the whole policy.
   */
  const toUpload: string[] = [];
  const toDownload: string[] = [];

  for (const photo of photos) {
    if (photo.uploadedAt === undefined) {
      // Only what this device actually holds. A record whose bytes live on
      // somebody else's phone is not this device's to upload.
      if (!owed.has(photo.id) && (await store.has(photo.id))) toUpload.push(photo.id);
      continue;
    }

    if (!(await store.has(photo.id))) toDownload.push(photo.id);
  }

  pending = Math.max(0, toUpload.length - PER_PASS) + Math.max(0, toDownload.length - PER_PASS);

  for (const id of toUpload.slice(0, PER_PASS)) {
    if (await upload(id, store)) uploaded += 1;
    else pending += 1;
  }

  for (const id of toDownload.slice(0, PER_PASS)) {
    if (await download(id, store)) downloaded += 1;
    else pending += 1;
  }

  return { uploaded, downloaded, pending };
}

async function upload(id: string, store: PhotoBytes): Promise<boolean> {
  try {
    const body = await store.read(id);
    // The record says there are bytes and the file is gone — a photo deleted
    // out from under the app. Nothing to send and nothing to fix here.
    if (body === null) return false;

    const res = await fetch(photoUrl(id), {
      method: 'PUT',
      headers: syncHeaders({ 'content-type': 'image/jpeg' }),
      body: body as BodyInit,
    });

    /**
     * A 404 means the metadata has not reached the server yet, which is the
     * ordinary race on a first sync: the record is in the same flush this
     * transfer is chasing. Left pending, and the next pass finds it landed.
     *
     * A 403 is a role that may not add photos, and retrying will never fix
     * it — but it is also not this module's business to escalate, and the
     * next pass costs one request.
     */
    if (!res.ok) return false;

    /**
     * Stamped from THIS device's clock and immediately suspect, like every
     * other client timestamp in this app (invariant 4). It is used for one
     * question — does this record's image exist on the server — and the answer
     * is carried by the field being present rather than by its value.
     */
    await enqueue({
      entity: 'photo',
      op: 'update',
      targetId: id,
      payload: { uploadedAt: Date.now() },
    });

    return true;
  } catch {
    // Offline. The record keeps its missing `uploadedAt` and the next pass
    // tries again, which is the same shape the mutation queue uses.
    return false;
  }
}

async function download(id: string, store: PhotoBytes): Promise<boolean> {
  try {
    const res = await fetch(photoUrl(id), { headers: syncHeaders() });
    // 404 here is a record whose `uploadedAt` says the bytes exist and the
    // server disagrees. Nothing to retry into; the gallery already says this
    // device does not have the image, which stays true.
    if (!res.ok) return false;

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength === 0) return false;

    await store.write(id, new Uint8Array(buffer));
    return true;
  } catch {
    return false;
  }
}
