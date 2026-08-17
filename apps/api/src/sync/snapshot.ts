import {
  entitySchema,
  opSchema,
  PULL_PAGE_SIZE,
  type PullResponse,
  type PulledMutation,
} from '@steading/contracts';
import type { Scoped, Tenanted } from '../db/scoped';
import { HttpError } from '../http';
import { isUndecided, shouldReplicate } from './outcome';

/**
 * Hydration, as a function of a scope and a cursor.
 *
 * Extracted so the Next route and the Fastify route call the SAME code rather
 * than each holding a copy. Two servers are live at once during the migration,
 * and a hydration cursor is exactly the wrong thing to have two of: a
 * difference between them would only surface after a reinstall, on whichever
 * server that device happened to talk to.
 */

interface MutationDoc extends Tenanted {
  targetId: string;
  entity: string;
  op: string;
  payload: unknown;
  deviceId: string;
  clientSeq: number;
  clientTs: number;
  schemaVersion: number;
  serverTs: Date;
  /**
   * What the applier decided. `unknown` on purpose — this is a database read,
   * and `shouldReplicate` is the only thing allowed to interpret it.
   */
  outcome?: unknown;
}

export interface SnapshotCursor {
  since: number;
  sinceId: string | null;
}

/**
 * Rejects a malformed cursor rather than defaulting it to "everything".
 *
 * Takes `unknown` because the two servers hand it different things. Next gives
 * `string | null` from URLSearchParams; Fastify's query parser gives an ARRAY
 * for a repeated parameter, so `?since=1&since=2` arrives as `['1','2']`
 * despite the type. Coercing that with `Number()` happens to yield NaN and
 * fail safely, which is luck rather than a design — so the shape is checked
 * instead of assumed (invariant 11).
 */
export function parseSnapshotCursor(rawSince: unknown, rawSinceId: unknown): SnapshotCursor {
  const invalid = new HttpError(400, 'That request is missing a valid starting point.');

  if (rawSince !== null && rawSince !== undefined && typeof rawSince !== 'string') throw invalid;
  if (rawSinceId !== null && rawSinceId !== undefined && typeof rawSinceId !== 'string') {
    throw invalid;
  }

  // An empty string is not zero. It means the caller sent the parameter and
  // left it blank, which is a bug on their side worth surfacing.
  const since = rawSince === null || rawSince === undefined ? 0 : Number(rawSince);
  if (!Number.isFinite(since) || since < 0 || rawSince === '') throw invalid;

  const sinceId = rawSinceId ?? null;
  if (sinceId !== null && sinceId.length !== 26) throw invalid;

  return { since, sinceId };
}

export async function readSnapshotPage(
  scope: Scoped,
  { since, sinceId }: SnapshotCursor,
): Promise<PullResponse> {
  /**
   * Seek past the cursor PAIR, not past the timestamp.
   *
   * serverTs is millisecond-resolution and a batch stamps many mutations
   * inside the same millisecond, so "everything after this timestamp" drops
   * every sibling row when a page boundary falls mid-millisecond. The $or
   * takes rows in a later millisecond, plus rows in the same millisecond with
   * a higher ULID — a total order, so no row can fall between pages.
   *
   * The $or is ANDed with the scoped layer's top-level orgId equality, so it
   * cannot widen the result set beyond this tenant.
   */
  const after = new Date(since);
  const cursor =
    sinceId === null
      ? { serverTs: { $gt: after } }
      : { $or: [{ serverTs: { $gt: after } }, { serverTs: after, _id: { $gt: sinceId } }] };

  // One extra row tells us whether another page exists without a count.
  const docs = await scope
    .col<MutationDoc>('mutations')
    .findMany(cursor, { limit: PULL_PAGE_SIZE + 1, sort: { serverTs: 1, _id: 1 } });

  const hasMore = docs.length > PULL_PAGE_SIZE;
  const page = hasMore ? docs.slice(0, PULL_PAGE_SIZE) : docs;

  const mutations: PulledMutation[] = [];

  /**
   * How far the watermark has earned the right to move — rows this page is
   * *finished with*, rather than rows it read.
   *
   * Every skip below is permanent except one, and the exception is what this
   * counter exists for. See `isUndecided`.
   */
  let consumed = 0;
  let stalled = false;

  for (const doc of page) {
    /**
     * Stop, rather than skip.
     *
     * A row whose client died between the log write and the projection is
     * `pending` until it resends or the sweeper decides it. Skipping it moves
     * the cursor past a row that is about to start replicating, and every
     * device that pulled during that window then misses the record
     * permanently — the server repairs its own projection and the farm's other
     * phones never hear about it.
     *
     * Ending the page here holds the log's order instead. The cost is that
     * rows behind an undecided one wait with it, bounded by the sweep interval
     * in the worst case and by the client's own resend — milliseconds — in the
     * ordinary one. That is the right way round: a bounded wait for a record
     * that arrives, rather than a fast page that silently drops one.
     */
    if (isUndecided(doc.outcome)) {
      stalled = true;
      break;
    }
    consumed += 1;

    /**
     * The log records every command that was ATTEMPTED. The feed carries only
     * the ones that changed something.
     *
     * Without this, a refusal the server issued on purpose — a hand editing
     * somebody else's note, an hour reading below the meter — is written into
     * every other device on the farm as though it had been accepted, and the
     * one device that knows it was refused is the one that sent it.
     *
     * Filtered here rather than in the query so the watermark still advances
     * past what it skips, exactly as the unknown-entity skip below does. A
     * query filter would leave the cursor parked before a run of refused rows
     * and rescan them on every pull; `more` stays honest either way, because it
     * is measured on rows READ.
     */
    if (!shouldReplicate(doc.outcome)) continue;

    // Rows written by a newer deploy may carry an entity this build does not
    // know. Skipping them is right: a client that cannot model a record should
    // not guess at it, and the watermark still advances past it.
    const entity = entitySchema.safeParse(doc.entity);
    const op = opSchema.safeParse(doc.op);
    if (!entity.success || !op.success) continue;

    mutations.push({
      schemaVersion: doc.schemaVersion,
      id: doc._id,
      targetId: doc.targetId,
      entity: entity.data,
      op: op.data,
      payload: doc.payload,
      deviceId: doc.deviceId,
      clientSeq: doc.clientSeq,
      clientTs: doc.clientTs,
      serverTs: doc.serverTs.getTime(),
    });
  }

  // The watermark comes from the last row CONSUMED, not the last row kept, so
  // a page made entirely of permanently-skipped rows still makes progress —
  // and a page that stopped at an undecided row does not move past it.
  const last = page[consumed - 1];

  return {
    mutations,
    through: last ? last.serverTs.getTime() : since,
    throughId: last ? last._id : sinceId,
    /**
     * `false` when stalled, though there are certainly more rows on disk.
     *
     * `more` drives the client's paging loop, and the honest answer to the
     * question it actually asks — *is there another page I can have now* — is
     * no. Saying yes would spend a round trip re-reading up to the same
     * undecided row and stopping in the same place. The next ordinary pull
     * picks up whatever has been decided by then.
     */
    more: stalled ? false : hasMore,
  };
}
