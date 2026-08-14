import { type Entitlement, entitlementOf } from '@steading/contracts';
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
   * **Unless it has been told to ask anyway.** A box whose install page is on
   * the open internet is the case this default gets wrong: the app is free and
   * meant to be, but a stranger's records landing in somebody else's database
   * is not the free part. `SYNC_REQUIRES_GRANT` makes the two comps above and a
   * redeemed promotion code the only ways through, which is what D13 says the
   * shape is — sync is the thing sold — arriving before Play does rather than
   * after.
   *
   * A refused farm is told *"Kept on this phone. Everything works; nothing is
   * sent anywhere."* — which is true, mentions no store it could not reach, and
   * sits directly above the field where a code goes.
   */
  if (env.playConfig === null && !env.SYNC_REQUIRES_GRANT) {
    return { syncing: true, refusal: null };
  }

  /**
   * A redeemed promotion code writes a subscription (A2.6), so it arrives here
   * rather than as a fourth special case — which is why the code path needed no
   * work to start meaning something on a server with no Play at all.
   */
  return entitlementOf(org?.subscription, Date.now());
}
