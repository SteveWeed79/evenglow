import { getRandomValues } from 'expo-crypto';
import { configureIds } from '@steading/contracts';

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

import { registerRootComponent } from 'expo';
import { App } from './src/App';

// registerRootComponent rather than AppRegistry directly: it also sets up the
// Expo dev client and error overlay, which is the difference between a red
// screen with a stack trace and a white screen with nothing.
registerRootComponent(App);
