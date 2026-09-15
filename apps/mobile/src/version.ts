/**
 * What build this is, for a support ticket to name.
 *
 * Read from `app.json` at build time rather than from `expo-constants` at
 * runtime, because the value is needed while assembling a bundle on a device
 * that may be about to crash again — and a native module call is one more
 * thing that can fail in exactly that moment.
 *
 * It is also in the fingerprint, so the same message from two releases is two
 * defects rather than one; see `fingerprintOf`.
 */
import app from '../app.json';

export const APP_VERSION: string = app.expo.version;

/**
 * Which commit this build came from, or empty when nothing said.
 *
 * Written by `scripts/stamp-build.mjs` into `.env.local`, which Expo's bundler
 * inlines on this exact member expression — so it is a literal in the bundle
 * and costs nothing at runtime. `process.env[name]` would not be substituted
 * and would read as undefined on a handset, which is why it is spelled out.
 *
 * **Deliberately not part of `APP_VERSION`, and this is the load-bearing
 * decision.** `APP_VERSION` goes into the fingerprint, so folding a commit
 * into it would give every build a new fingerprint for every defect — one
 * issue thread per build, which during a tester programme is a new thread
 * every few days for the same fault. That is precisely the flood the
 * fingerprint exists to prevent.
 *
 * So it travels beside the version: enough to answer "which build are you on"
 * without splitting the report it arrived with.
 */
export const APP_BUILD: string = process.env.EXPO_PUBLIC_BUILD ?? '';

/**
 * How this copy of the app was installed, which decides what it may say about
 * updates — `[23]`, and the reason it is a build-time stamp.
 *
 * **A Play build must never offer an APK link.** Google Play's Device and
 * Network Abuse policy forbids an app distributed through Play from updating
 * itself by any other route, and the box cannot answer for a Play device
 * anyway: it knows what was published, while Play decides what each device may
 * have — staged rollouts, review, an unsupported API level. A nag nobody can
 * act on is worse than silence, so on Play the question goes to Play.
 *
 * `getInstallSourceInfo()` would be the runtime answer and needs a native
 * module this app does not have. A stamp costs nothing and `TESTING-BUILD.md`
 * already draws the line it needs: `production` is the AAB for Play, and every
 * other profile is an APK we serve ourselves.
 *
 * **Absent means the shelf**, which is the right default twice over — every
 * build that exists today came from the shelf, and a local `expo run:android`
 * sets nothing. The value that has to be declared is the one with the policy
 * attached, so a profile nobody remembered to stamp cannot silently become a
 * Play build that offers a download.
 */
export const APP_CHANNEL: string = process.env.EXPO_PUBLIC_CHANNEL ?? 'shelf';

/** Whether this build is allowed to send somebody to the box for an APK. */
export function installsFromShelf(): boolean {
  return APP_CHANNEL !== 'play';
}
