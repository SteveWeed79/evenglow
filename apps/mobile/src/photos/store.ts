import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import {
  getPendingResultAsync,
  launchCameraAsync,
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
  type ImagePickerAsset,
} from 'expo-image-picker';
import { localStore } from '@steading/core/db/store';

/**
 * Where a photo's bytes live, and how one is taken.
 *
 * ## Two cases, and only two
 *
 * **Receipts and manuals on kit**, because the history you hand over with a
 * machine is what LookOver sells on and a receipt cannot be reconstructed
 * later. And **evidence** — a wound, a kill, a diseased leaf — which is the
 * one a keeper actually reaches for and the one that cannot be taken
 * afterwards.
 *
 * Per-animal portraits are deliberately absent. You tell six hens apart with a
 * leg ring, not a photograph; that belongs to the pet-chicken market and not
 * to this app. See `docs/ROADMAP.md`.
 *
 * ## The bytes stay on the device, and the record syncs
 *
 * `photoShape` has said so since it was written — *"metadata only, the Blob is
 * uploaded separately, which is why `uploadedAt` is optional: the record syncs
 * before the bytes do."* This builds that half. A second device sees the
 * record and knows a photo exists; it does not yet have the image.
 *
 * That is an honest state rather than a broken one, and the gallery says so
 * plainly rather than showing a grey box. Adding the upload later sets
 * `uploadedAt` and fetches on miss — additive, not a redesign.
 *
 * **`Paths.document`, not `Paths.cache`.** The export writes to cache because
 * a CSV exists to be handed over and has no value afterwards. A photo is the
 * record. The OS reclaiming it would be data loss.
 *
 * ## Resized on the way in, deliberately
 *
 * A modern phone camera produces 4–8 MB per frame. A receipt is legible at
 * 1600px and a wound is diagnosable at it, so storing the original would be
 * twenty times the bytes for no readable difference — and photos are the one
 * thing in this app that is not small. This is the difference between a
 * hundred photos costing 30 MB and costing 600 MB.
 */

/** Long edge, in pixels. Legible for a receipt, honest for a wound. */
const MAX_EDGE = 1600;

/** JPEG quality. 0.7 is where artefacts stop being visible on a phone. */
const QUALITY = 0.7;

const FOLDER = 'photos';

/** The directory photos live in, created on first use. */
function folder(): Directory {
  const dir = new Directory(Paths.document, FOLDER);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/**
 * A photo's file, named for its record.
 *
 * The record's `targetId` is the filename, so nothing has to store a path and
 * nothing can point at a file that belongs to a different record. A ULID is
 * already unique and already the thing the rest of the app holds.
 */
export function photoFile(id: string): File {
  return new File(folder(), `${id}.jpg`);
}

/** Whether this device actually has the bytes for a record it can see. */
export function hasBytes(id: string): boolean {
  return photoFile(id).exists;
}

export function photoUri(id: string): string {
  return photoFile(id).uri;
}

/** Removes the bytes. The record is archived separately, never deleted (P13). */
export function forgetBytes(id: string): void {
  const file = photoFile(id);
  if (file.exists) file.delete();
}

export interface Captured {
  byteSize: number;
  capturedAt: number;
}

/**
 * Room to take one, checked before the camera opens rather than after.
 *
 * `[36]`. A full device is not a rare state on a farm phone — it is a phone
 * with four years of photographs on it, which is most of them — and the app
 * met it in the worst possible order: open the camera, let somebody frame a
 * wound they are worried about, take it, and then fail while writing. The
 * subject of that photograph does not wait to be photographed twice.
 *
 * ## Why the floor is well above one photo
 *
 * A capture is not one file's worth of disk. `manipulateAsync` writes its
 * output to a temporary before the move, so the original and the shrunk copy
 * exist at once; the mutation lands in SQLite, which grows its WAL; and the
 * upload later reads the whole file. Ten megabytes is roughly three times the
 * worst case a single photo can cost, which is the margin worth having when
 * the alternative is failing halfway.
 *
 * It is deliberately not a percentage. A tenth of a 512 GB tablet is fifty
 * gigabytes, which would refuse a photo on a device with room for fifteen
 * thousand of them.
 */
const ROOM_FOR_A_PHOTO = 10_000_000;

/**
 * The device is out of room, said before anything irreversible happens.
 *
 * Distinct from `StorageFullError`, which is the store's: this one is about a
 * photograph that has not been taken yet, and the useful advice is different.
 * A farm cannot free space by syncing here — the bytes are the weight, and
 * they are on this phone until they are uploaded.
 */
export class NoRoomForPhotoError extends Error {
  constructor() {
    super('This phone is out of room for photographs. Free some space and try again.');
    this.name = 'NoRoomForPhotoError';
  }
}

/**
 * Whether there is room, in a form the caller can act on.
 *
 * Returns true when it cannot tell. The property is a synchronous native read
 * and it can throw on a platform or a filesystem that will not answer; a
 * device that declines to say how much room it has is not a device that is
 * known to be full, and refusing a photograph on a guess is worse than the bug
 * this guards against.
 */
export function roomForAPhoto(): boolean {
  try {
    return Paths.availableDiskSpace >= ROOM_FOR_A_PHOTO;
  } catch {
    return true;
  }
}

/**
 * Takes or picks a photo, shrinks it, and writes it under `id`.
 *
 * Returns null when the person backed out or refused the camera — a cancel is
 * not a failure and must not put an error on the screen.
 */
export async function capture(
  id: string,
  source: 'camera' | 'library',
): Promise<Captured | null> {
  // Before the permission prompt and before the camera: the whole point is
  // that nobody frames a shot this app already knows it cannot keep.
  if (!roomForAPhoto()) throw new NoRoomForPhotoError();

  if (source === 'camera') {
    const permission = await requestCameraPermissionsAsync();
    // Refusing the camera is an answer, not an error. The library is still
    // there and the screen keeps working.
    if (!permission.granted) return null;
  }

  const picked =
    source === 'camera'
      ? await launchCameraAsync({ quality: 1 })
      : await launchImageLibraryAsync({ quality: 1 });

  /**
   * Cleared here, and only here, because reaching this line means the OS gave
   * control back — cancel included. A pending note left behind after a
   * successful capture would be recovered again on the next launch and write a
   * second record for one photograph.
   */
  await localStore().setPendingPhoto(null).catch(() => undefined);

  if (picked.canceled) return null;

  const asset = picked.assets[0];
  if (asset === undefined) return null;

  return store(id, asset);
}

/**
 * The half of `capture` that runs after the OS hands an image back — shared
 * with the recovery path, which starts here because its picker call already
 * happened in a process that no longer exists.
 */
async function store(id: string, source: ImagePickerAsset | string): Promise<Captured> {
  const uri = typeof source === 'string' ? source : source.uri;
  /**
   * Dimensions are the picker's when it gave any, and unknown on the recovery
   * path — where there is no asset, only a file. Unknown means the resize is
   * skipped and the compression still runs, which is the right trade: a photo
   * kept at full size is a photo kept.
   */
  const asset = typeof source === 'string' ? null : source;
  /**
   * Resized on the long edge, whichever that is.
   *
   * Passing only one dimension keeps the aspect ratio, and choosing by which
   * is longer means a portrait receipt and a landscape field both come out at
   * the same worst-case size. A photo already smaller than the limit is left
   * alone rather than being upscaled into a bigger file.
   */
  const longest = asset === null ? 0 : Math.max(asset.width, asset.height);
  const resize =
    asset !== null && longest > MAX_EDGE
      ? [
          asset.width >= asset.height
            ? { resize: { width: MAX_EDGE } }
            : { resize: { height: MAX_EDGE } },
        ]
      : [];

  const shrunk = await manipulateAsync(uri, resize, {
    compress: QUALITY,
    format: SaveFormat.JPEG,
  });

  const destination = photoFile(id);
  if (destination.exists) destination.delete();

  // Moved rather than copied: the manipulator's output is a temporary the OS
  // will clear, and copying would leave two of everything until it did.
  await new File(shrunk.uri).move(destination);

  return { byteSize: destination.size ?? 0, capturedAt: Date.now() };
}

/**
 * A photograph taken by a process that did not survive to keep it.
 *
 * Reported as *"Steading takes the pic then restarts and the pic is lost."*
 * Android can destroy the activity while the camera is in front of it — low
 * memory, or "Don't keep activities" left on in Developer options — and the
 * app that comes back is a new one. Everything held in memory is gone,
 * including the id the photo was going to be filed under.
 *
 * `getPendingResultAsync` is expo-image-picker's answer to that: the result
 * the destroyed activity never received. It answers once, at launch, and the
 * id and subject come from `pendingPhoto`, which was written down before the
 * camera opened for exactly this reason.
 *
 * Returns what the caller needs to enqueue the record — this module writes
 * bytes and does not know about mutations, which is the same split `capture`
 * has always had with `Photos.tsx`.
 *
 * Silent on every failure. A recovered photo is a bonus at launch; nothing
 * here may stop the app opening.
 */
export async function recoverPendingPhoto(): Promise<
  ({ id: string; subjectId: string } & Captured) | null
> {
  const pending = await localStore()
    .getPendingPhoto()
    .catch(() => null);
  if (pending === null) return null;

  // One attempt. A note that cannot be resolved must not be retried at every
  // launch for ever.
  await localStore().setPendingPhoto(null).catch(() => undefined);

  try {
    const result = await getPendingResultAsync().catch(() => null);
    const asset =
      result !== null && 'assets' in result && !result.canceled ? result.assets?.[0] : undefined;

    const uri = asset?.uri ?? abandonedCapture(pending.at);
    if (uri === null || uri === undefined) return null;

    const kept = await store(pending.id, uri);
    return { id: pending.id, subjectId: pending.subjectId, ...kept };
  } catch {
    return null;
  }
}

/**
 * The photograph itself, found on disk after the process that asked for it was
 * killed.
 *
 * `getPendingResultAsync` recovers a picture only when the ACTIVITY was
 * destroyed and the process lived — its store is a field on the module
 * (`private var pendingMediaPickingResult`), not SharedPreferences, so a
 * process death takes it with everything else. On a tablet that is the common
 * case rather than the exotic one: the camera app is the most memory-hungry
 * thing on the device, and Android takes the memory from whatever is in the
 * background, which is us.
 *
 * But the picture is not in memory. `CameraContract` passes the camera an
 * `EXTRA_OUTPUT` file made by `createOutputFile(cacheDirectory, "jpg")`, and
 * the camera app writes the JPEG there itself, before returning. So the file
 * has already landed on disk by the time we are killed — in
 * `<cache>/ImagePicker/`, which is a constant in the module
 * (`CACHE_DIR_NAME = "ImagePicker"`).
 *
 * Newer than the moment the camera was opened, so a leftover from some earlier
 * capture is never adopted as this one. Newest first, because two files inside
 * one pending window means the camera was opened twice and the last is the one
 * somebody was looking at.
 */
function abandonedCapture(openedAt: number): string | null {
  try {
    const dir = new Directory(Paths.cache, 'ImagePicker');
    if (!dir.exists) return null;

    const shots = dir
      .list()
      .filter((entry): entry is File => entry instanceof File)
      /**
       * Milliseconds since the epoch, which `File.modificationTime` documents.
       *
       * This was briefly written to accept `at > openedAt || at * 1000 >
       * openedAt`, in case some platform reported seconds — and that second
       * clause is true for **every** file ever written, because any plausible
       * seconds-value multiplied by a thousand exceeds any plausible
       * milliseconds-value. It did not make the check tolerant, it deleted it,
       * and a stale capture from last week would have been adopted as this
       * one. Defensive code that cannot fail is not defensive.
       */
      .filter((file) => (file.modificationTime ?? 0) > openedAt)
      .sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0));

    return shots[0]?.uri ?? null;
  } catch {
    return null;
  }
}
