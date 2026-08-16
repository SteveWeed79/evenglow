import { afterEach, describe, expect, it } from 'vitest';
import { capture, NoRoomForPhotoError, roomForAPhoto } from '../../apps/mobile/src/photos/store';
import { camera, disk } from '../support/native/modules';

/**
 * A phone with no room left, met before the camera opens rather than after.
 *
 * `[36]`. A full device is not a rare state on a farm phone — it is a phone
 * with four years of photographs on it, which is most of them — and the app
 * used to meet it in the worst possible order: open the camera, let somebody
 * frame a wound they are worried about, take the shot, and fail while writing
 * it. The subject of that photograph does not wait around to be photographed a
 * second time.
 *
 * The refusal is deliberately not a percentage of the disk and deliberately
 * larger than one photo. See `ROOM_FOR_A_PHOTO`.
 */

const GENEROUS = 8_000_000_000;

afterEach(() => {
  disk.available = GENEROUS;
});

describe('whether there is room', () => {
  it('says yes on an ordinary phone', () => {
    disk.available = GENEROUS;
    expect(roomForAPhoto()).toBe(true);
  });

  it('says no when a photo would not fit three times over', () => {
    // Enough for one photo and not enough for the temporary the resize writes
    // beside it, which is the case that used to fail halfway.
    disk.available = 2_000_000;
    expect(roomForAPhoto()).toBe(false);
  });

  it('says yes when the device will not say, rather than guessing', () => {
    Object.defineProperty(disk, 'available', {
      configurable: true,
      get() {
        throw new Error('this platform does not answer that');
      },
    });

    // A device that declines to say how much room it has is not a device known
    // to be full, and refusing a photograph on a guess is worse than the bug.
    expect(roomForAPhoto()).toBe(true);

    Object.defineProperty(disk, 'available', { configurable: true, value: GENEROUS, writable: true });
  });
});

describe('taking one on a full phone', () => {
  it('refuses before the camera opens', async () => {
    disk.available = 1_000;
    camera.resizes.length = 0;

    await expect(capture('01J0000000000000000000PHOT', 'camera')).rejects.toThrow(
      NoRoomForPhotoError,
    );

    // The whole point: the camera was never reached, so nobody framed a shot
    // this app already knew it could not keep.
    expect(camera.resizes).toEqual([]);
  });

  it('says what to do about it, in words a farm can act on', async () => {
    disk.available = 1_000;

    let message = '';
    try {
      await capture('01J0000000000000000000PHOT', 'library');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('out of room');
    expect(message).toContain('Free some space');
  });
});
