/**
 * Which way up the app is allowed to be.
 *
 * ## The bug
 *
 * Reported from a handset: "rotation is busted on the tablet". It was.
 * `app.json` said `"orientation": "portrait"`, which `@expo/config-plugins`
 * writes onto the main activity as `android:screenOrientation="portrait"` — a
 * hard lock on a tablet exactly as much as on a phone. Turn the thing sideways
 * and Android pillarboxes a portrait app in the middle of a landscape screen,
 * or simply refuses.
 *
 * `tokens.ts` and `tests/screens/reading-column.test.tsx` both asserted the
 * opposite — that the lock "does not hold on a tablet" because an app targeting
 * Android SDK 36 has its orientation restrictions ignored on displays 600dp and
 * wider. **That behaviour belongs to Android 16, not to the target level.** It
 * is the OS on the device that decides to ignore the manifest, so a tablet
 * running anything earlier honours the lock completely. The one this was found
 * on reports API 35. Both comments have been corrected.
 *
 * ## Why the manifest change was not the whole fix
 *
 * `orientation: "default"` in `app.json` — already on main — unlocks the
 * activity, and `tests/unit/landscape-fold.test.ts` landed with it saying what
 * that costs: adding up the tokens the tally screen is built from, **a phone in
 * landscape is about 84dp short of showing its commit button**, and a tablet
 * fits in either orientation. R1 wants a daily log three taps from a cold
 * launch, and it is not three taps when the first one is a scroll. That file
 * recorded the shortfall as a debt to be paid later.
 *
 * Nor is portrait on a phone only an R1 problem. It is held one-handed over a
 * nest box, at an angle auto-rotate reads as landscape.
 *
 * So the lock comes back at runtime, for compact screens only, at the width the
 * arithmetic already put the line at. A phone behaves exactly as it did before
 * any of this; a tablet turns; the 84dp is not a debt the app ships with, it is
 * the price of ever lifting the lock.
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
 *
 * It also happens to be the line the fold arithmetic draws, arrived at from
 * completely different premises — `landscape-fold.test.ts` asserts the two
 * agree, so moving this number without answering that sum turns a test red.
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
