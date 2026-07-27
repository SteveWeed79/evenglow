import { describe, expect, it } from 'vitest';
import { isNative } from '@steading/app/platform';

/**
 * The one branch between the two entries.
 *
 * Getting it wrong in the false direction is the expensive one: a handset that
 * reports something unexpected falls through to IndexedDB, the app looks
 * completely fine, and a morning's work goes to a store the next launch does
 * not read. So the test names the platforms rather than testing `!== 'web'`,
 * which would silently call an unknown string native.
 */

describe('isNative', () => {
  it('is true on the platforms that ship an APK or IPA', () => {
    expect(isNative('android')).toBe(true);
    expect(isNative('ios')).toBe(true);
  });

  it('is false in a browser', () => {
    expect(isNative('web')).toBe(false);
  });

  it('is false for anything it does not recognise', () => {
    // Better to run the browser store in a browser-like environment than to
    // hand an unknown host a plugin it does not have.
    expect(isNative('electron')).toBe(false);
    expect(isNative('')).toBe(false);
  });
});
