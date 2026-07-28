import { setApiBase } from '@steading/app/api';
import { startSync, stopSync } from '@steading/app/sync/engine';
import { setStorageBacking } from '@steading/app/sync/storage';
import { type CachedClaims, refreshSession } from '../auth/session';
import { openLocalStore } from '../db/store';
import { startTriggers } from '../sync/triggers';

/**
 * Everything that must be true before the first screen renders.
 *
 * Order is load-bearing and each step earns its place:
 *
 * 1. **The API base**, first, because it throws. A missing base is a
 *    configuration mistake and it must surface at launch as a sentence, not
 *    at the first flush as a network error — those are indistinguishable from
 *    inside the app, so the queue would back off politely forever while the
 *    sync chip said the reassuring thing.
 * 2. **The session**, because the database is per-farm and you cannot open
 *    the right file until you know whose it is. This is also why a flush loop
 *    started without a token would be wrong twice over: every batch 401s, and
 *    the engine correctly treats that as "stay queued, do not burn an
 *    attempt" — right, and also a queue that silently never sends.
 * 3. **The store**, before anything reads. Last migration's worst bug was a
 *    window where screens read a database that had never been written to.
 * 4. **The storage backing**, because the work is now in the app's private
 *    sandbox. The browser answers — quota, eviction after a week of
 *    idleness — are not merely unavailable on a handset, they are wrong.
 * 5. **The triggers and the loop**, last, because they are the only steps
 *    that touch the network.
 */

/**
 * `EXPO_PUBLIC_` is inlined at build time by Expo's bundler, same as Vite's
 * `VITE_`. It ships inside the APK and is trivially extractable, so an origin
 * is the only thing that may go here — never a secret (invariant 12).
 */
const API_BASE = process.env.EXPO_PUBLIC_API_URL;

export interface Started {
  /** Null when nobody is signed in on this device. */
  claims: CachedClaims | null;
  stop(): void;
}

export async function start(): Promise<Started> {
  if (API_BASE === undefined || API_BASE === '') {
    throw new Error(
      'EXPO_PUBLIC_API_URL is not set. The app needs an absolute API origin — ' +
        'there is no same-origin server to fall back to on a handset. See the README.',
    );
  }
  setApiBase(API_BASE);

  /**
   * Offline is not signed out.
   *
   * `refreshSession` returns the cached claims when the request itself fails,
   * and only clears the device when the server actually refuses. A farmer
   * opening the app in a barn with no signal stays signed in and keeps
   * logging — that is the entire premise, and it is also what makes it safe
   * to put the session ahead of the store: the orgId comes from the cache
   * when the network cannot answer.
   */
  const claims = await refreshSession();

  // Nothing else starts until somebody is signed in. There is no database to
  // open without an orgId and nothing to sync without a token.
  if (claims === null) return { claims: null, stop() {} };

  await openLocalStore(claims.orgId);
  setStorageBacking('device');

  const triggers = startTriggers();
  startSync();

  return {
    claims,
    stop() {
      stopSync();
      triggers.stop();
    },
  };
}
