import { NextResponse } from 'next/server';
import { syncRequestSchema, type SyncResponse } from '@steading/contracts';
import { requireMutationSession } from '@/server/auth/session';
import { scoped } from '@steading/api/db/scoped';
import { errorResponse, HttpError } from '@/server/http';
import { applyBatch } from '@steading/api/sync/apply';

/**
 * The only write path for offline data.
 *
 * Never answers a bare 200: the body is a per-mutation result array, because a
 * batch can be partly applied and the client has to know exactly which entries
 * to clear from its queue and which to route to the rejected inbox (A6).
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

    // .strict() makes a payload-supplied orgId a hard 400 rather than a
    // silently ignored field (C2). orgId comes from the session, only.
    const parsed = syncRequestSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where = first && first.path.length > 0 ? ` (${first.path.join('.')})` : '';
      throw new HttpError(400, `That batch could not be read${where}.`);
    }

    const scope = await scoped(claims.orgId);
    const results = await applyBatch(scope, claims, parsed.data.mutations);

    const response: SyncResponse = { results, serverTs: Date.now() };
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
