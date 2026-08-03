import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import {
  launchCameraAsync,
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
} from 'expo-image-picker';

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
 * Takes or picks a photo, shrinks it, and writes it under `id`.
 *
 * Returns null when the person backed out or refused the camera — a cancel is
 * not a failure and must not put an error on the screen.
 */
export async function capture(
  id: string,
  source: 'camera' | 'library',
): Promise<Captured | null> {
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

  if (picked.canceled) return null;

  const asset = picked.assets[0];
  if (asset === undefined) return null;

  /**
   * Resized on the long edge, whichever that is.
   *
   * Passing only one dimension keeps the aspect ratio, and choosing by which
   * is longer means a portrait receipt and a landscape field both come out at
   * the same worst-case size. A photo already smaller than the limit is left
   * alone rather than being upscaled into a bigger file.
   */
  const longest = Math.max(asset.width, asset.height);
  const resize =
    longest > MAX_EDGE
      ? [
          asset.width >= asset.height
            ? { resize: { width: MAX_EDGE } }
            : { resize: { height: MAX_EDGE } },
        ]
      : [];

  const shrunk = await manipulateAsync(asset.uri, resize, {
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
