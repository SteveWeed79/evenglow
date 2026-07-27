import { NextResponse } from 'next/server';
import { scoped } from '@steading/api/db/scoped';
import { handleSyncBatch } from '@steading/api/sync/batch';
import { requireMutationSession } from '@/server/auth/session';
import { errorResponse, HttpError } from '@/server/http';

/**
 * The Next adapter over the shared batch handler.
 *
 * Everything about what is accepted and what is rejected lives in
 * `@steading/api/sync/batch`, which the Fastify route also calls. Both servers
 * are live during the migration, and a batch endpoint that differed between
 * them would reach a user as work landing in the rejected inbox depending on
 * which host happened to answer.
 *
 * This file goes away with the rest of the Next surface in S7.
 */

// Mongo driver and argon2 are Node-only.
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // Identity, org, and role are re-derived server-side before anything is read.
    const claims = await requireMutationSession();

    const body: unknown = await request.json().catch(() => {
      throw new HttpError(400, 'That request body is not valid JSON.');
    });

    const scope = await scoped(claims.orgId);
    return NextResponse.json(await handleSyncBatch(scope, claims, body), { status: 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
