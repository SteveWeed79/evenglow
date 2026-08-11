import { describe, expect, it } from 'vitest';
import { ROTATES_AT, rotationFor } from '../../apps/mobile/src/theme/rotation';
import { LAYOUT } from '../../apps/mobile/src/theme/tokens';

/**
 * Which way up the app is allowed to be.
 *
 * Reported from a handset: "rotation is busted on the tablet". It was —
 * `app.json` said `orientation: "portrait"`, which lands on the main activity
 * as `android:screenOrientation="portrait"` and locks a tablet as hard as it
 * locks a phone. The manifest no longer locks; this is the rule that took over.
 *
 * Asserted rather than commented because the whole thing is invisible on the
 * device it is developed against. A phone comes out of every one of these cases
 * exactly as it went in, so nothing on a phone can catch a regression here.
 */

/** Shortest-edge dp, which is the only dimension the rule looks at. */
const SCREENS = {
  'iPhone SE': [320, 568],
  'Pixel 7': [412, 915],
  'a large phone': [430, 932],
  'the widest phone': [480, 1040],
  'a 7" tablet': [600, 960],
  'Galaxy Tab': [800, 1280],
  'iPad Pro': [1024, 1366],
} as const;

describe('rotation', () => {
  it('holds a phone upright', () => {
    for (const name of ['iPhone SE', 'Pixel 7', 'a large phone', 'the widest phone'] as const) {
      const [w, h] = SCREENS[name];
      expect(rotationFor(w, h), name).toBe('portrait_up');
    }
  });

  it('lets a tablet turn', () => {
    for (const name of ['a 7" tablet', 'Galaxy Tab', 'iPad Pro'] as const) {
      const [w, h] = SCREENS[name];
      expect(rotationFor(w, h), name).toBe('default');
    }
  });

  /**
   * The bug this exists to prevent, and the reason the rule reads the *screen*
   * rather than the window.
   *
   * A rule computed from the window would see 932 × 430 the instant a phone
   * was turned — briefly, by hand, before the lock took — call it a tablet, and
   * unlock it with no way back: the wider it got the more tablet it would look.
   * Reading the shorter edge of the display makes the answer the same whichever
   * way round the arguments arrive.
   */
  it('gives the same answer whichever way the device is held', () => {
    for (const [name, [w, h]] of Object.entries(SCREENS)) {
      expect(rotationFor(h, w), `${name} rotated`).toBe(rotationFor(w, h));
    }
  });

  /**
   * `portrait_up`, not `portrait`.
   *
   * react-native-screens maps `portrait` to `SCREEN_ORIENTATION_SENSOR_PORTRAIT`,
   * which permits upside-down; the manifest's `portrait` meant
   * `SCREEN_ORIENTATION_PORTRAIT`, which does not. Handing the navigator the
   * wrong one of those would leave a phone newly able to flip 180° — a change
   * nobody asked for, shipped inside a fix for something else.
   */
  it('locks a phone the way the manifest used to', () => {
    expect(rotationFor(412, 915)).toBe('portrait_up');
  });

  it('turns at the width Android calls a tablet', () => {
    expect(ROTATES_AT).toBe(600);
    // Both are 600 and neither is derived from the other: one is where the app
    // stops growing, the other is where it starts turning.
    expect(ROTATES_AT).toBe(LAYOUT.column);
    expect(rotationFor(ROTATES_AT - 1, 2000)).toBe('portrait_up');
    expect(rotationFor(ROTATES_AT, 2000)).toBe('default');
  });
});
