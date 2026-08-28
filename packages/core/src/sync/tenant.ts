import { accessTokenOrg } from '../api';
import { storeGeneration, storeOrgId } from '../db/store';

/**
 * Why a sync pass must stop, if it must.
 *
 * Two reasons rather than one because they are different moments and a
 * diagnostics sheet reading `deferred` should be able to tell them apart:
 * `farm-switched` is the store having moved under a pass already running,
 * `farm-switching` is the token having moved ahead of the store and the two
 * halves not yet describing the same farm.
 */
export type TenantMove = 'farm-switched' | 'farm-switching';

/**
 * The fence every step that spans an await sits behind.
 *
 * **A device holds one farm's database at a time, and the two things that say
 * which farm do not move together.** `setAccessToken` happens inside
 * `establish`; the database is opened afterwards, by the boot, across a close,
 * an open and a migration ladder. So there is a window — many awaits wide, and
 * the one a real sign-in lands in — where the bearer token is farm B's and the
 * SQLite file is still farm L's.
 *
 * The generation counter cannot see that window at all. It answers "has the
 * store moved?", and in that window the store is exactly where it was; both
 * existing fences (`flush`, `pull`) compared the generation to itself and read
 * as stable. A tick landing there either flushes farm L's queue under farm B's
 * token — the server takes `orgId` from the token, so those records are
 * created in the wrong org and come back `applied`, and the device that logged
 * them never sends them anywhere again — or pulls farm B's snapshot into farm
 * L's database.
 *
 * So the fence asks both questions:
 *
 *   - **did the store move**, which catches a switch landing mid-pass; and
 *   - **do the token and the store name the same farm**, which catches the two
 *     being out of step whether or not either has moved since the pass began.
 *
 * **A missing answer is not a mismatch.** Either side may be null — a test
 * installing a bare store, a device with no session yet — and null means
 * unknown, not "any". Blocking on an absence would stall every device that has
 * a store and no token, which is every device before its first sign-in, and it
 * would buy nothing: this is a device-side consistency fence, and authorization
 * is the server's, re-derived from the token on every mutation (invariant 8).
 * Blocking only on a *known* mismatch still fails closed for the hazard, which
 * is two known values that disagree.
 *
 * Captured once, at the top of a pass, and asked again after each await.
 */
export function tenantFence(): () => TenantMove | null {
  const generation = storeGeneration();

  return () => {
    if (storeGeneration() !== generation) return 'farm-switched';

    const token = accessTokenOrg();
    const store = storeOrgId();
    if (token !== null && store !== null && token !== store) return 'farm-switching';

    return null;
  };
}
