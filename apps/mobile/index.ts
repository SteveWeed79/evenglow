import { getRandomValues } from 'expo-crypto';
import { configureIds } from '@homefarm/contracts';

/**
 * The device's random source, installed before anything can mint an ID.
 *
 * `ulid` looks for `crypto.getRandomValues` on the global and throws when
 * there is none. React Native provides no `crypto` — neither core nor Expo's
 * runtime installs one — so every entity ID on a handset depended on a global
 * that is not there. `expo-crypto` is the platform primitive for this; there
 * is no other, and `Math.random` is not one, because the ULID is the
 * idempotency key the server dedupes on.
 *
 * At the very top of the entry file on purpose: `newId()` is called from
 * screens, from the enqueue envelope, and from a device-id migration that runs
 * while the store is opening. Any of those can be the first.
 */
configureIds(() => {
  const byte = getRandomValues(new Uint8Array(1))[0] ?? 0;
  return byte / 256;
});

import * as SplashScreen from 'expo-splash-screen';
import { registerRootComponent } from 'expo';
import { App } from './src/App';

/**
 * Hold the splash until the app has something real behind it.
 *
 * Without this the native splash comes down at the *first React Native frame*,
 * which is well before this app is ready to be looked at: `Boot` is still
 * opening the database and `useAppFonts` is still reading four faces out of
 * the APK. So the mark would appear for a few frames, vanish into a spinner,
 * and the farm would reasonably report never having seen a splash at all.
 *
 * At module scope, and above `registerRootComponent`, because the thing it
 * has to beat is the first render — an effect is already too late.
 */
SplashScreen.preventAutoHideAsync().catch(() => {
  // Rejects rather than resolves when the splash is already gone, which is the
  // ordinary case on a fast warm start. There is nothing to hold and nothing
  // worth reporting.
});

// registerRootComponent rather than AppRegistry directly: it also sets up the
// Expo dev client and error overlay, which is the difference between a red
// screen with a stack trace and a white screen with nothing.
registerRootComponent(App);
