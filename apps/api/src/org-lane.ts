/**
 * One lane per farm, for the operations that are a read and then a write.
 *
 * A precheck and the act it guards are two statements, and something can always
 * happen between them. The membership rules are all of that shape — count the
 * owners then demote one, find the live join code then replace it — so two
 * requests arriving together each see a world in which their own change is safe
 * and together produce one that is not. Two owners removing each other in the
 * same second leave a farm with none.
 *
 * ## Why a lane rather than a database constraint
 *
 * A unique partial index expresses "at most one" and cannot express "at least
 * one", which is the rule that matters here. Mongo's `partialFilterExpression`
 * also refuses `$exists: false`, so "the live code" is not directly indexable
 * either without a marker field and a migration to add it.
 *
 * The other answer is a multi-document transaction, which needs a replica set —
 * and `setup-mongo.sh` and `DEPLOY-THE-SERVER.md` record a checked decision to
 * run standalone precisely because nothing needed one. Reaching for it here
 * would be reversing an architectural decision to fix a race that a mutex fixes
 * outright.
 *
 * ## The assumption, stated rather than left as folklore
 *
 * **Exact under one API process per farm, and worth nothing across two.** That
 * is the deployment — one systemd unit on one box, written down under "One API
 * process per farm, and that one IS load-bearing" — and it is the same
 * assumption `sync/commit-order.ts` already rests on, which is why the two share
 * this lane rather than each keeping a mutex of their own. If a second instance
 * is ever run, both need the same answer, and finding one answer is better than
 * discovering there were two places that needed it.
 *
 * Uncontended at farm write volume. A membership change is a rare, deliberate
 * act; what this serialises is two of them landing in the same moment, and the
 * sync path that shares the lane holds it per mutation rather than per batch.
 */

/**
 * One chain per org. The value is the tail of the queue, and it never rejects —
 * it is resolved from a `finally`, so work that throws cannot wedge everything
 * queued behind it for that farm.
 */
const lanes = new Map<string, Promise<void>>();

/**
 * Runs `work` after everything already queued for this org, and before anything
 * queued after it.
 */
export async function inOrgOrder<T>(orgId: string, work: () => Promise<T>): Promise<T> {
  const previous = lanes.get(orgId) ?? Promise.resolve();

  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  lanes.set(orgId, mine);

  await previous;
  try {
    return await work();
  } finally {
    release();
    // Only when nobody queued behind us, so a server holding many farms does
    // not accumulate a promise per org for ever.
    if (lanes.get(orgId) === mine) lanes.delete(orgId);
  }
}

/** Test seam. The map is process-wide, and a suite must not inherit another's. */
export function resetOrgLanes(): void {
  lanes.clear();
}
