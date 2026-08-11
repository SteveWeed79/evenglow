/**
 * Which way up the app is allowed to be.
 *
 * ## The bug this fixes
 *
 * `app.json` said `"orientation": "portrait"`, which `@expo/config-plugins`
 * writes onto the main activity as `android:screenOrientation="portrait"`. On
 * a tablet that is a hard lock: turn the thing sideways and Android pillarboxes
 * a portrait app in the middle of a landscape screen, or simply refuses.
 * Reported from a handset as "rotation is busted on the tablet", which is
 * exactly what it was.
 *
 * `tokens.ts` and `tests/screens/reading-column.test.tsx` both asserted the
 * opposite — that the lock "does not hold on a tablet" because an app targeting
 * Android SDK 36 has its orientation restrictions ignored on displays 600dp and
 * wider. **That behaviour belongs to Android 16, not to the target level.** It
 * is the OS on the device that decides to ignore the manifest, so a tablet
 * running anything earlier honours the lock completely. The one this was found
 * on reports API 35. Both comments have been corrected.
 *
 * ## Why not simply unlock everything
 *
 * Because portrait on a phone is not an oversight. A phone is held one-handed
 * over a nest box at an angle auto-rotate reads as landscape, and R1 wants a
 * daily log three taps from a cold launch — which it is not when the commit
 * button has just gone below the fold. `tally.ts` already carries the arithmetic
 * for how badly a 430dp-tall screen goes, and calls it "the real defect".
 *
 * So: the manifest stops locking, and the lock is re-applied at runtime to
 * compact screens only. A phone behaves exactly as it did; a tablet turns.
 *
 * ## Why this needs no new dependency
 *
 * `expo-screen-orientation` is the obvious reach and it is not needed.
 * `@react-navigation/native-stack` already takes an `orientation` screen option
 * and hands it to `react-native-screens`, which sets `requestedOrientation` on
 * the activity — both are dependencies today because the navigator requires
 * them. The manifest cannot express "portrait below 600dp" at all: the
 * attribute is an enum resolved at build time and takes no resource qualifier.
 */

/**
 * The shortest screen edge, in dp, at or above which the app turns freely.
 *
 * 600 is Android's own threshold for calling a display large — the `sw600dp`
 * resource qualifier — so the app rotates at exactly the width the platform
 * starts treating it as a tablet. It is the same number as `LAYOUT.column` and
 * that is not a coincidence worth collapsing: one is where the app stops
 * growing, the other is where it starts turning, and either could move without
 * the other.
 */
export const ROTATES_AT = 600;

/**
 * What to hand the navigator's `orientation` option.
 *
 * `portrait_up` rather than `portrait`, and the difference is not cosmetic:
 * react-native-screens maps `portrait` to `SCREEN_ORIENTATION_SENSOR_PORTRAIT`,
 * which permits upside-down, while the manifest's `portrait` meant
 * `SCREEN_ORIENTATION_PORTRAIT`, which does not. `portrait_up` is the exact
 * equivalent of what shipped, so a phone comes out of this change behaving
 * identically rather than newly able to flip 180° in somebody's hand.
 */
export type Rotation = 'portrait_up' | 'default';

/**
 * Both edges of the *screen*, not the window.
 *
 * The shorter of the two is invariant under rotation — which is the whole
 * point, since a rule computed from the window would unlock a phone the moment
 * it was briefly landscape and then have no way back. It does move on a
 * foldable, which is the case the caller subscribes for.
 */
export function rotationFor(screenWidth: number, screenHeight: number): Rotation {
  return Math.min(screenWidth, screenHeight) < ROTATES_AT ? 'portrait_up' : 'default';
}
