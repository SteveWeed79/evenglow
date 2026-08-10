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
   * A server that takes no payments asks for none. The self-hosted case, and
   * the one where a subscription state is meaningless — nobody could have
   * bought anything.
   */
  if (env.playConfig === null) return { syncing: true, refusal: null };

  /** Comped in the server's own environment — testers, and whoever runs it. */
  if (org !== null && env.freeSyncOrgs.has(org._id)) return { syncing: true, refusal: null };

  /** Comped in the database, by `pnpm farm:grant`. Same decision, no restart. */
  if (org?.syncGranted !== undefined) return { syncing: true, refusal: null };

  return entitlementOf(org?.subscription, Date.now());
}
