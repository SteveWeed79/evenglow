import { describe, expect, it } from 'vitest';
import { MAX_PHOTO_BYTES, newId, photoCreateSchema, photoUpdateSchema } from '@homefarm/contracts';

/**
 * How large a photo may be, and why the number is what it is.
 *
 * The device resizes to a 1600px long edge at JPEG quality 0.7 before anything
 * leaves it, which is 200–400 KB typically and around 1.2 MB for the densest
 * subject a farm photographs. An un-resized frame from a phone camera is 4–8 MB.
 * `MAX_PHOTO_BYTES` is chosen to sit between those two populations, so it
 * admits every resized photo and refuses the one thing that means the resize
 * never ran.
 *
 * These assertions are about the *boundary*, which is the whole point of having
 * the limit on the record as well as on the bytes: an oversized photo is
 * refused before a barn's uplink has been spent on it. `ACCESS-AND-BILLING.md`
 * §4.1a asked for exactly that.
 *
 * The ceiling was 25 MB — sixty times a typical photo. (It used to be argued
 * against a free managed tier's 512 MB as well; the database is on the box now,
 * and the resize argument is the one that survives.)
 */

function photo(byteSize: number) {
  return {
    subjectId: newId(),
    contentType: 'image/jpeg' as const,
    byteSize,
    capturedAt: 1_700_000_000_000,
  };
}

describe('how big a photo may be', () => {
  it('sits between a resized photo and an un-resized camera frame', () => {
    /**
     * The two numbers the limit exists to separate. Asserted rather than left
     * in a comment, because the limit is only correct relative to what the
     * device produces — and if `MAX_EDGE` or `QUALITY` in `photos/store.ts`
     * ever move, this is what should fail and force the question.
     */
    const densestResizedPhoto = 1_200_000;
    const smallestRawCameraFrame = 4_000_000;

    expect(MAX_PHOTO_BYTES).toBeGreaterThan(densestResizedPhoto);
    expect(MAX_PHOTO_BYTES).toBeLessThan(smallestRawCameraFrame);
  });

  it('accepts a photo the size the app actually produces', () => {
    // 200-400 KB is the ordinary case; 1.2 MB is the worst realistic one.
    for (const size of [180_000, 300_000, 400_000, 1_200_000]) {
      expect(photoCreateSchema.safeParse(photo(size)).success).toBe(true);
    }
  });

  it('accepts a photo exactly at the ceiling', () => {
    expect(photoCreateSchema.safeParse(photo(MAX_PHOTO_BYTES)).success).toBe(true);
  });

  it('refuses one byte over', () => {
    expect(photoCreateSchema.safeParse(photo(MAX_PHOTO_BYTES + 1)).success).toBe(false);
  });

  it('refuses an un-resized camera frame', () => {
    // What arrives when the resize path is bypassed or fails — the case the
    // limit exists for.
    for (const size of [4_000_000, 8_000_000, 25_000_000]) {
      expect(photoCreateSchema.safeParse(photo(size)).success).toBe(false);
    }
  });

  it('refuses a zero-byte or negative photo', () => {
    expect(photoCreateSchema.safeParse(photo(0)).success).toBe(false);
    expect(photoCreateSchema.safeParse(photo(-1)).success).toBe(false);
  });

  it('holds the same ceiling on an update, not only on a create', () => {
    /**
     * `photoUpdateSchema` is the create shape made partial, so it inherits the
     * constraint — but a replaced image is exactly when an oversized file would
     * arrive, so it is worth an assertion rather than an assumption.
     */
    expect(photoUpdateSchema.safeParse({ byteSize: MAX_PHOTO_BYTES }).success).toBe(true);
    expect(photoUpdateSchema.safeParse({ byteSize: MAX_PHOTO_BYTES + 1 }).success).toBe(false);
  });
});
