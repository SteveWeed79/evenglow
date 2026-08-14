import { useEffect, useSyncExternalStore } from 'react';
import {
  claimsSnapshot,
  readCachedClaims,
  subscribeToClaims,
  type CachedClaims,
} from '../auth/store';

/**
 * Who this device is, kept current.
 *
 * Replaces the `useEffect(() => { void readCachedClaims().then(setX) }, [])`
 * that every screen needing an account had written for itself. That shape reads
 * once and keeps the answer, which is right for signing *in* — the tree
 * remounts around it — and wrong for signing out, where the value changes under
 * screens that are already standing.
 *
 * Reported from the phone as the sign-out button never changing, and *"it
 * doesn't look like anything changes on the app until after it is restarted"*.
 * Restarting fixed it because the storage had been correct all along; it was
 * the screens that were stale.
 *
 * ## Three states, and the third is not the second
 *
 * - `undefined` — nothing has read yet.
 * - `null` — read, and this device has no account. **The ordinary case**, not
 *   an error: D14 says the app opens with no account and stays that way as
 *   long as somebody likes.
 * - a `CachedClaims` — read, and there is one.
 *
 * A caller that shows "no account" while the value is still `undefined` will
 * flash the wrong sentence on every launch, which is why `undefined` is a state
 * a caller can see rather than being folded into `null`.
 *
 * ## UX only
 *
 * Invariant 8, unchanged. This makes a cached claim timely; it does not make it
 * authorization. The server re-derives identity, org and role on every mutation
 * regardless of anything decided here.
 */
export function useAccount(): CachedClaims | null | undefined {
  const account = useSyncExternalStore(subscribeToClaims, claimsSnapshot, claimsSnapshot);

  /**
   * A read on mount, every mount.
   *
   * The subscription covers everything that changes claims *through this app* —
   * signing in, signing out, joining a farm — so re-reading looks redundant.
   * It is not, and the reason is that the module cache can go stale against
   * storage that something else moved: the tests seed the keychain directly,
   * and a restore or a future migration would too. A cache with no way back to
   * its source is a cache that is eventually confidently wrong.
   *
   * It is close to free. `publishClaims` compares before it notifies, so a read
   * that finds what is already known wakes nobody and re-renders nothing, and
   * `readCachedClaims` has no throwing path — an unrecognised shape is
   * discarded and published as `null`.
   */
  useEffect(() => {
    void readCachedClaims();
  }, []);

  return account;
}
