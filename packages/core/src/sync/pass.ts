import { accessTokenOrg, syncHeaders } from '../api';
import type { LocalStore } from './../db/port';
import { localStore, storeGeneration, storeOrgId } from '../db/store';

/**
 * Why a sync pass stopped, if it did.
 *
 * Two words rather than one because they are different moments and a
 * diagnostics sheet reading `deferred` should be able to tell them apart:
 * `farm-switched` is the store having been replaced under a pass already
 * running; `farm-switching` is the token naming a farm the store does not,
 * which is every moment of a sign-in between the token arriving and the
 * database opening.
 */
export type TenantMove = 'farm-switched' | 'farm-switching';

export type Headers = Record<string, string>;

/** Headers for a request on this farm's behalf, or the reason none may be sent. */
export type Send = { ok: true; headers: Headers } | { ok: false; because: TenantMove };

/**
 * One farm's turn at the network: the store it writes and the farm it speaks
 * for, fixed when the pass begins.
 *
 * ## The fence, made structural
 *
 * A device holds one farm's database at a time, and the two things that say
 * which farm do not move together. `setAccessToken` happens inside
 * `establish`; the database is opened afterwards, across a close, an open and
 * a migration ladder. So there is a window — many awaits wide, and the one a
 * real sign-in lands in — where the bearer token is farm B's and the SQLite
 * file is still farm L's. And a switch can land inside a pass that was
 * already running, so that the store it started on is not the store
 * installed when its answer arrives.
 *
 * The first version of this fence was a closure asked *"has anything
 * moved?"* before each write, and its own comment said it had to be asked
 * again after every await. Three writes were found without it, then three
 * more, and the audit that found the second three said the next were a
 * matter of time — which is what a rule enforced by remembering to apply it
 * always is.
 *
 * This is the same fence with the remembering taken out of it:
 *
 *   - **Writes go to `store`, the handle captured here.** Nothing in a pass
 *     calls `localStore()` again — `eslint.config.mjs` refuses the import in
 *     the pass files — so a switch landing mid-pass cannot redirect an answer
 *     to another farm's database. The worst it can do is find this handle
 *     closed, which throws, which the engine reports. Loud beats wrong.
 *   - **Requests carry the headers `send()` returns**, and `send()` refuses
 *     while the token names a farm this store does not hold. Asked at the
 *     moment of sending, every time, including the retry after a renewal —
 *     because a renewal reads the token the sign-in has since replaced.
 *
 * `moved()` survives for reporting: a pass whose store was replaced tells the
 * loop so with `deferred: 'farm-switched'`, and skips writes that could only
 * meet a closed handle. It is a courtesy to the diagnostics sheet and to the
 * error report, not what keeps another farm's data out of this one's.
 *
 * **A missing answer is not a mismatch.** Either org may be null — a test
 * installing a bare store, a device with no session yet — and null means
 * unknown, not "any". Blocking on an absence would stall every device that
 * has a store and no token, which is every device before its first sign-in,
 * and it would buy nothing: this is a device-side consistency fence, and
 * authorization is the server's, re-derived from the token on every mutation
 * (invariant 8). Blocking only on a *known* mismatch still fails closed for
 * the hazard, which is two known values that disagree.
 */
export interface Pass {
  readonly store: LocalStore;
  /** The farm `store` holds, or null when the installer did not say. */
  readonly orgId: string | null;
  send(extra?: Headers): Send;
  /** Whether the store was replaced since the pass began. Reporting, not protection. */
  moved(): TenantMove | null;
}

export function beginPass(): Pass {
  const store = localStore();
  const orgId = storeOrgId();
  const generation = storeGeneration();

  const tokenNamesAnotherFarm = (): boolean => {
    const token = accessTokenOrg();
    return token !== null && orgId !== null && token !== orgId;
  };

  return {
    store,
    orgId,
    send(extra = {}) {
      if (tokenNamesAnotherFarm()) return { ok: false, because: 'farm-switching' };
      return { ok: true, headers: syncHeaders(extra) };
    },
    moved() {
      return storeGeneration() === generation ? null : 'farm-switched';
    },
  };
}
