import { NextResponse } from 'next/server';
import {
  entitySchema,
  opSchema,
  type PullResponse,
  PULL_PAGE_SIZE,
  type PulledMutation,
} from '@/lib/contracts/mutation';
import { requireSession } from '@/server/auth/session';
import { scoped, type Tenanted } from '@/server/db/scoped';
import { errorResponse, HttpError } from '@/server/http';

/**
 * Hydration. Ships the org's mutation log from a watermark forward, so a new
 * device — or a reinstall, or a second phone — can rebuild local state.
 *
 * The log is shipped rather than the projected documents, because the client
 * already knows how to turn a mutation into a local record: it does exactly
 * that on every enqueue. One projection path, used by both, means the two
 * cannot drift.
 *
 * Read-only, so requireSession is enough — there is no mutation here to
 * re-derive a role for. Tenancy is the scoped layer's job as always.
 */

export const runtime = 'nodejs';

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

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const claims = await requireSession();

    const raw = new URL(request.url).searchParams.get('since') ?? '0';
    const since = Number(raw);
    if (!Number.isFinite(since) || since < 0) {
      throw new HttpError(400, 'That request is missing a valid starting point.');
    }

    const scope = await scoped(claims.orgId);

    // One extra row tells us whether another page exists without a count.
    const docs = await scope.col<MutationDoc>('mutations').findMany(
      { serverTs: { $gt: new Date(since) } },
      { limit: PULL_PAGE_SIZE + 1, sort: { serverTs: 1 } },
    );

    const more = docs.length > PULL_PAGE_SIZE;
    const page = more ? docs.slice(0, PULL_PAGE_SIZE) : docs;

    const mutations: PulledMutation[] = [];
    for (const doc of page) {
      // Rows written by a newer deploy may carry an entity this build does not
      // know. Skipping them is right: a client that cannot model a record
      // should not guess at it, and the watermark still advances past it.
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
    const through = last ? last.serverTs.getTime() : since;

    const response: PullResponse = { mutations, through, more };
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
