import { describe, expect, it } from 'vitest';
import { isImageType, sniffImageType } from '@homefarm/api/routes/image-bytes';

/**
 * What the bytes are, rather than what the request said they were.
 *
 * The photo route accepted a body under three declared content types and
 * stored it; nothing anywhere looked at the bytes. These are the leading-byte
 * checks that closed it, tested here without a server because that is where a
 * signature belongs — one wrong constant and every upload of that format is
 * refused, which is a failure a farm would report as "the camera is broken".
 */

const jpeg = (...tail: number[]) => Buffer.from([0xff, 0xd8, 0xff, ...tail]);
const png = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = () =>
  Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBP')]);

describe('what a photo is allowed to be', () => {
  it('knows a JFIF JPEG', () => {
    expect(sniffImageType(jpeg(0xe0, 0x00, 0x10))).toBe('image/jpeg');
  });

  /** Exif and JFIF differ at the fourth byte, which is why only three are read. */
  it('knows an Exif JPEG, which a phone camera actually produces', () => {
    expect(sniffImageType(jpeg(0xe1, 0x00, 0x10))).toBe('image/jpeg');
  });

  it('knows a PNG by its full eight-byte signature', () => {
    expect(sniffImageType(png())).toBe('image/png');
  });

  /**
   * A WebP is a RIFF container, so the four size bytes between the magic and
   * the format tag are skipped rather than matched — they are the file's own
   * length and differ per image.
   */
  it('knows a WebP past its size field', () => {
    expect(sniffImageType(webp())).toBe('image/webp');
  });

  it('refuses a RIFF that is not a WebP', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([1, 0, 0, 0]),
      Buffer.from('WAVE'),
    ]);
    expect(sniffImageType(wav)).toBeNull();
  });

  it.each([
    ['a script', Buffer.from('<script>alert(1)</script>')],
    ['an HTML page', Buffer.from('<!doctype html><html></html>')],
    ['a zip', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])],
    ['an ELF binary', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0])],
    ['a PDF', Buffer.from('%PDF-1.7')],
    ['nothing at all', Buffer.alloc(0)],
  ])('refuses %s', (_what, bytes) => {
    expect(sniffImageType(bytes)).toBeNull();
  });

  /**
   * A truncated signature is not a match. Worth its own case because the
   * obvious implementation — comparing a slice — returns true for an empty
   * buffer against an empty slice.
   */
  it('refuses a signature cut short', () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e]))).toBeNull();
  });
});

describe('the accepted list', () => {
  it('accepts exactly the three the route parses', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(isImageType(type)).toBe(true);
    }
  });

  it.each([['image/gif'], ['image/svg+xml'], ['text/html'], ['application/json']])(
    'does not accept %s',
    (type) => {
      expect(isImageType(type)).toBe(false);
    },
  );

  /** It reads a record field, which is a database read and therefore unknown. */
  it.each([[undefined], [null], [42], [{}]])('does not accept %s from a record', (value) => {
    expect(isImageType(value)).toBe(false);
  });
});
