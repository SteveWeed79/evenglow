import { NextResponse } from 'next/server';
import { scoped } from '@steading/api/db/scoped';
import { parseSnapshotCursor, readSnapshotPage } from '@steading/api/sync/snapshot';
import { requireSession } from '@/server/auth/session';
import { errorResponse } from '@/server/http';

/**
 * The Next adapter over the shared snapshot reader.
 *
 * The cursor logic lives in `@steading/api/sync/snapshot`, which the Fastify
 * `/snapshot` route also calls. A hydration cursor is exactly the wrong thing
 * to keep two copies of while two servers are live: a difference between them
 * would only surface after a reinstall, on whichever server that device
 * happened to talk to.
 *
 * Read-only, so requireSession is enough — there is no mutation here to
 * re-derive a role for. Tenancy is the scoped layer's job as always.
 *
 * This file goes away with the rest of the Next surface in S7.
 */

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const claims = await requireSession();

    const params = new URL(request.url).searchParams;
    const cursor = parseSnapshotCursor(params.get('since'), params.get('sinceId'));

    const scope = await scoped(claims.orgId);
    return NextResponse.json(await readSnapshotPage(scope, cursor), { status: 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
