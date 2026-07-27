import {
  entitySchema,
  opSchema,
  PULL_PAGE_SIZE,
  type PullResponse,
  type PulledMutation,
} from '@steading/contracts';
import type { Scoped, Tenanted } from '../db/scoped';
import { HttpError } from '../http';

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

  const more = docs.length > PULL_PAGE_SIZE;
  const page = more ? docs.slice(0, PULL_PAGE_SIZE) : docs;

  const mutations: PulledMutation[] = [];
  for (const doc of page) {
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

  // The watermark comes from the last row read, not the last row kept, so a
  // page made entirely of skipped rows still makes progress.
  const last = page[page.length - 1];

  return {
    mutations,
    through: last ? last.serverTs.getTime() : since,
    throughId: last ? last._id : sinceId,
    more,
  };
}
