/**
 * What the bytes actually are, rather than what the request said they were.
 *
 * ## The gap this closes
 *
 * `PUT /photos/:id` accepted a body under three declared content types and
 * stored it, and the GET served it back under the type from the *record*.
 * Nothing anywhere looked at the bytes. So the store held whatever anybody with
 * a farm account chose to send — a script, an HTML page, a zip — filed as an
 * image and served with an image's content type.
 *
 * With a React Native `Image` on the other end that is close to harmless, which
 * is exactly why it is worth fixing now rather than after: the day one photo URL
 * is opened in a WebView, a browser, or a support tool, the bytes decide what
 * happens and the declared type does not. `nosniff` on the response is the other
 * half and neither is sufficient alone.
 *
 * ## Magic numbers, not a decoder
 *
 * A handful of leading bytes, checked against the type the caller declared. It
 * is not proof the file is a *valid* image — that needs a decoder, which is a
 * dependency, an attack surface of its own, and CPU spent on every upload from
 * a farm on a hill with one bar of signal. It is proof the file is not
 * something else entirely, which is the whole of what was missing.
 *
 * Sources: JFIF/Exif start of image (`FF D8 FF`); the PNG signature from RFC
 * 2083 §3.1; and the RIFF container with `WEBP` at offset 8.
 */

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Every type the photo route accepts, in one place so the two cannot drift. */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function isImageType(value: unknown): value is ImageType {
  return (
    typeof value === 'string' && (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(value)
  );
}

function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, i) => bytes[i] === byte);
}

/**
 * The type these bytes actually are, or null for anything else.
 *
 * Returns the type rather than a boolean so the caller can compare it against
 * what it was told and store the answer it trusts. A PNG uploaded under
 * `image/jpeg` is a mismatch worth refusing rather than quietly re-labelling:
 * it means the client's own record and its bytes disagree, and the record is
 * what every other device on the farm will read.
 */
export function sniffImageType(bytes: Buffer): ImageType | null {
  // FF D8 FF — start of image, shared by JFIF and Exif JPEGs.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  // The eight-byte PNG signature. The trailing bytes are the CR/LF and EOF
  // traps the format includes to catch a transfer that mangled line endings.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  // RIFF....WEBP — a container, so the four size bytes at 4 are skipped.
  if (
    bytes.length >= 12 &&
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}
