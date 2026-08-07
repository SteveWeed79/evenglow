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
