import { type Entitlement, entitlementOf, type SyncRefusal } from '@steading/contracts';
import type { Env } from '../env';
import type { OrgDoc } from '../db/identity';

/**
 * Whether this server will take a farm's work, and why not when it will not.
 *
 * ## Why this exists rather than two routes each deciding
 *
 * `/billing` used to call `entitlementOf` directly, under a comment promising
 * *"the same sentence the sync route sends, from the same function, so the
 * account screen and the chip cannot come to disagree."* The function was
 * shared; the three conditions in front of it were not.
 *
 * `/sync` asks whether this server takes payments at all, and whether the farm
 * is on the granted list, before it asks what the farm has paid. `/billing`
 * asked only the last one. On a server with no Play configuration — which is
 * every self-hosted farm, and the state this project is in today — the result
 * was a device that had just synced successfully being told, on the account
 * screen, *"Kept on this phone. Everything works; nothing is sent anywhere."*
 *
 * Reported from a handset with both screens open: `Last sent Aug 10, 9:43 AM`
 * on one and `nothing is sent anywhere` on the other, about the same minute.
 * A farm that catches the app contradicting itself about where its records are
 * has no reason to believe the next thing it says about them.
 *
 * So the whole decision lives here and both routes call it. Shared reasoning
 * rather than a shared subroutine, which is what the promise was worth.
 */
export function syncAccess(env: Env, org: OrgDoc | null): Entitlement {
  /**
   * Comped first, and this used to be third.
   *
   * The order did not matter while a server with no Play configuration said
   * yes to everybody before it got here — the two checks below could never
   * decide anything the line after them had not already decided. It matters
   * now that `SYNC_REQUIRES_GRANT` can make that line ask rather than answer:
   * a granted farm must be granted whether or not this server sells anything.
   */

  /** Comped in the server's own environment — testers, and whoever runs it. */
  if (org !== null && env.freeSyncOrgs.has(org._id)) return { syncing: true, refusal: null };

  /** Comped in the database, by `pnpm farm:grant`. Same decision, no restart. */
  if (org?.syncGranted !== undefined) return { syncing: true, refusal: null };

  /**
   * A server that takes no payments asks for none. The self-hosted case, and
   * the one where a subscription state is meaningless — nobody could have
   * bought anything.
   *
   * **Only when it has been told to be open.** A box whose install page is on
   * the open internet is the case the old default got wrong: the app is free
   * and meant to be, but a stranger's records landing in somebody else's
   * database is not the free part. So the two comps above and a redeemed
   * promotion code are the ways through, which is what D13 says the shape is —
   * sync is the thing sold — arriving before Play does rather than after.
   *
   * This was a flag that had to be turned ON to close the hole, and a hole
   * stays open when closing it is a step somebody has to remember. Inverted, so
   * the safe state is the one you get by doing nothing.
   *
   * A refused farm is told *"Kept on this phone. Everything works; nothing is
   * sent anywhere."* — which is true, mentions no store it could not reach, and
   * sits directly above the field where a code goes.
   */
  if (env.playConfig === null && env.SYNC_OPEN_TO_ALL) {
    return { syncing: true, refusal: null };
  }

  /**
   * A redeemed promotion code writes a subscription (A2.6), so it arrives here
   * rather than as a fourth special case — which is why the code path needed no
   * work to start meaning something on a server with no Play at all.
   */
  return entitlementOf(org?.subscription, Date.now());
}

/**
 * Which of the ways through a farm actually came in by, or why it did not.
 *
 * `syncAccess` answers the question a request asks — *may this farm write* —
 * and collapses four different yeses into one `syncing: true`. An operator
 * asking *what is this farm's situation* needs them apart: a comped farm and a
 * paying farm are the same to the wire and nothing like each other on a page
 * about who is subscribed.
 *
 * **The branch order is `syncAccess`'s, deliberately duplicated rather than
 * derived**, and that is the thing to be careful about. A readout that
 * disagrees with what a farm experiences is worse than no readout, so the
 * pairing is pinned by a test that walks every combination and asserts this
 * says a refusal exactly when `syncAccess` says it cannot sync. If somebody
 * reorders one, that test fails rather than the operations page quietly
 * describing a farm that does not exist.
 *
 * This is what `farm:ls` had wrong. It read `syncGranted` and the subscription
 * and nothing else, so a farm comped through `FREE_SYNC_ORGS` — the mechanism
 * for testers and for whoever runs the server, which is to say the farms most
 * likely to be looked up — listed as `unsubscribed` while syncing perfectly.
 */
export type FarmSyncState = 'comped' | 'granted' | 'open' | 'paid' | SyncRefusal;

export function farmSyncState(env: Env, org: OrgDoc): FarmSyncState {
  /** Comped in the server's own environment, and it wins over everything. */
  if (env.freeSyncOrgs.has(org._id)) return 'comped';

  /** Comped in the database, by `pnpm farm:grant`. */
  if (org.syncGranted !== undefined) return 'granted';

  /** A server deliberately run open, which is not the same as a farm paying. */
  if (env.playConfig === null && env.SYNC_OPEN_TO_ALL) return 'open';

  return entitlementOf(org.subscription, Date.now()).refusal ?? 'paid';
}
