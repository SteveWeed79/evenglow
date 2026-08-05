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
