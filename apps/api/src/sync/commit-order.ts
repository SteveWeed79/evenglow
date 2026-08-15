import type { Scoped, Tenanted } from '../db/scoped';
import { inOrgOrder, resetOrgLanes } from '../org-lane';

/**
 * Making `(serverTs, _id)` an order over commits rather than over intentions.
 *
 * `snapshot.ts` seeks and sorts on that pair, and a device advances its
 * watermark past everything it has read. That is only sound if a row can never
 * become visible carrying a value below a watermark already published — and it
 * could, twice over:
 *
 *  1. `serverTs` was stamped while the document was being built, before the
 *     `await` on the upsert. Request A stamps T1 and stalls; B stamps T2,
 *     inserts, and is pulled; a device advances past T2; A finally inserts at
 *     T1, behind that watermark, permanently. That mutation is never pulled.
 *  2. The log write and the projection write are separate awaits, so two
 *     concurrent mutations can interleave in opposite orders — Mongo ends at
 *     A's value while a fresh client replaying the log in cursor order ends at
 *     B's. The server and a clean rebuild disagree, and **no cursor change
 *     fixes that one.** Only serialising the pair does.
 *
 * A wall-clock step backwards on the host reproduces the first with no
 * concurrency at all.
 *
 * ## Why not a monotonic counter document
 *
 * The obvious answer — `findOneAndUpdate($inc)` on a per-org counter — does not
 * work, and it is worth writing down so it is not proposed again. It allocates
 * the number in one operation and makes the row visible in another, so A can
 * allocate 5, stall, and insert behind a device that has already read 6. That
 * is failure 1 verbatim with an integer instead of a timestamp, bought at the
 * price of a serialization point and a collection.
 *
 * Assigning the number in the same operation that makes the row visible needs a
 * multi-document transaction, which needs a replica set. `setup-mongo.sh` and
 * `DEPLOY-THE-SERVER.md` record a checked decision to run standalone precisely
 * because nothing needs transactions or change streams, so that requirement is
 * a demand to reverse an architectural decision — and the counter does not meet
 * it anyway.
 *
 * ## What this does instead
 *
 * Restates the requirement as a property of visible order: **no row may become
 * visible carrying a cursor value below a watermark already published.** Under
 * one writer process that is satisfied by doing the stamp, the log write, the
 * projection and the outcome as one serialised unit per org, with the stamp
 * taken immediately before the insert rather than at request start.
 *
 * ## The assumption, stated rather than left as folklore
 *
 * **This is exact under one API process per farm, and buys nothing across two.**
 * That is true of the deployment today — one systemd unit on one box — and it
 * belongs written down next to the standalone-Mongo note rather than discovered
 * later. If a second instance is ever run, the answer is not this: it is a
 * single-node replica set with a transaction wrapping the allocation and the
 * insert, at which point the counter document becomes viable for the first
 * time.
 *
 * A reader-side horizon — serving only rows older than a few seconds — was
 * considered as defence in depth for that case and deliberately not taken. It
 * would delay every second device's propagation to defend a configuration that
 * does not exist, and it collides with the one-time projection repair: a
 * mutation hidden inside the horizon does not replay, so the record it belongs
 * to goes unmarked and the sweep treats it as an orphan. Self-healing on the
 * next pull, but a disappearing record is not a thing to introduce on purpose.
 */

/** Highest `serverTs` this process has issued per org, seeded lazily. */
const lastIssued = new Map<string, number>();

/**
 * Runs `work` after everything already queued for this org, and before anything
 * queued after it.
 *
 * In-process and uncontended at farm write volume: a batch is already applied
 * sequentially (A4), so the only thing this serialises is two devices flushing
 * the same farm in the same moment. Per mutation rather than per batch on
 * purpose — a hundred-mutation batch must not hold the farm's lock for its
 * whole flush.
 *
 * **The lane itself lives in `org-lane.ts` and is shared with the membership
 * routes**, which are check-then-act for the same reason and rest on the same
 * one-process assumption. Two mutexes over one farm would be two places to find
 * out that assumption had changed.
 */
export async function inCommitOrder<T>(orgId: string, work: () => Promise<T>): Promise<T> {
  return inOrgOrder(orgId, work);
}

interface StampedDoc extends Tenanted {
  serverTs: Date;
}

/**
 * The next `serverTs` for this org, strictly above every one already issued.
 *
 * **Called inside `inCommitOrder`, and only there.** The read and the write of
 * `lastIssued` are two statements, so outside the lock two callers could take
 * the same value and stamp two rows identically — which is the tie the cursor
 * pair exists to break, reintroduced at the source.
 *
 * The clamp is what survives a clock that moves backwards: NTP correcting a
 * drifted host, or an operator setting the date. Without it the mutex alone
 * still lets a later commit carry an earlier stamp, which is failure 1 with no
 * concurrency involved.
 *
 * Seeded from the newest row rather than from zero, because an in-memory floor
 * is lost on restart — and a restart is exactly when a corrected clock takes
 * effect. One indexed read per org per process: `{orgId, serverTs, _id}` is
 * walked in reverse with orgId pinned by equality, which is the read that index
 * comment already describes.
 */
export async function nextServerTs(scope: Scoped): Promise<Date> {
  let floor = lastIssued.get(scope.orgId);

  if (floor === undefined) {
    const [newest] = await scope
      .col<StampedDoc>('mutations')
      .findMany({}, { limit: 1, sort: { serverTs: -1 } });

    floor = newest?.serverTs instanceof Date ? newest.serverTs.getTime() : 0;
  }

  const next = Math.max(Date.now(), floor + 1);
  lastIssued.set(scope.orgId, next);
  return new Date(next);
}

/** Test seam. The maps are process-wide, and a suite must not inherit another's. */
export function resetCommitOrder(): void {
  resetOrgLanes();
  lastIssued.clear();
}
