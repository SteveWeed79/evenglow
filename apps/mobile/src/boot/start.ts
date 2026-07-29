import { startSync, stopSync } from '@steading/core/sync/engine';
import { setStorageBacking } from '@steading/core/sync/storage';
import { type CachedClaims, refreshSession } from '../auth/session';
import { openLocalStore } from '../db/store';
import { startTriggers, type TriggerHandles } from '../sync/triggers';
import { reportEngineError } from '@steading/core/sync/report';
import { type ApiFault, configureApi, explainFault } from './config';

/**
 * Everything that must be true before the first screen renders.
 *
 * Order is load-bearing and each step earns its place:
 *
 * 1. **The API base**, first, because everything after it may want the
 *    network. A missing or malformed origin no longer stops the boot — see
 *    `config.ts` for why an offline-first app must open without a server —
 *    but it does stop step 5.
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
 *    that touch the network — and the only steps a configuration fault skips.
 */

export interface Started {
  /** Null when nobody is signed in on this device. */
  claims: CachedClaims | null;
  /**
   * Set when the app has no usable server address. Everything local works;
   * nothing will sync. Null in the normal case.
   */
  fault: ApiFault | null;
  stop(): void;
}

/**
 * `raw` exists for tests, which must be able to boot an unconfigured app
 * without a bundler having inlined anything. Production calls `start()` and
 * gets the value Expo substituted at build time.
 */
export async function start(raw?: string): Promise<Started> {
  const config = configureApi(raw);

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
  if (claims === null) {
    /**
     * The one place a missing origin is genuinely fatal.
     *
     * Signing in *is* a server round trip, so there is no offline answer to
     * give: no cached claims, no orgId, no database, and no way to get one.
     * A nobody-is-signed-in device with no server address can do nothing at
     * all, and saying so plainly beats a sign-in form that fails on every tap
     * with a network error.
     */
    if (config.kind !== 'configured') throw new Error(explainFault(config));
    return { claims: null, fault: null, stop() {} };
  }

  await openLocalStore(claims.orgId);
  setStorageBacking('device');

  /**
   * Signed in, with nowhere to send anything.
   *
   * The store is open and every screen works, because the projection is what
   * the UI renders and it is on this device. What must NOT happen is starting
   * the loop: with no base the transports resolve `/sync` against nothing, so
   * every flush fails as a network error, and a network error is exactly what
   * being in a barn looks like. The queue would back off forever while the
   * chip reported the ordinary offline story. The fault is returned instead,
   * and the chip names it.
   */
  if (config.kind !== 'configured') return { claims, fault: config, stop() {} };

  /**
   * Past this line nothing may stop the app.
   *
   * The store is open, which means every record this farm has is readable and
   * every screen works. Sync is how that reaches the server — it is not how it
   * is kept. So a trigger that will not attach, or a loop that will not start,
   * is reported and stepped over.
   *
   * It used to be fatal, and the shape of that failure is the argument: one
   * throw inside `startTriggers` produced a full-screen "Steading could not
   * start" over a database sitting right there, under a sentence promising
   * nothing had been lost. Both halves were true and the app was still shut.
   */
  let triggers: TriggerHandles | null = null;
  try {
    triggers = startTriggers();
    startSync();
  } catch (error) {
    reportEngineError('starting the sync loop', error);
  }

  return {
    claims,
    fault: null,
    stop() {
      stopSync();
      triggers?.stop();
    },
  };
}
