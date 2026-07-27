import type { FastifyInstance } from 'fastify';
import { requireClaims, requireMutationClaims } from '../auth/require';
import { scoped } from '../db/scoped';
import type { Env } from '../env';
import { handleSyncBatch } from '../sync/batch';
import { parseSnapshotCursor, readSnapshotPage } from '../sync/snapshot';

/**
 * The sync surface.
 *
 * Both handlers are adapters and nothing more — parse the request, hand it to
 * the shared implementation, send what comes back. Every rule about what is
 * accepted, what is rejected, and how a page is cursored lives in
 * `sync/batch.ts` and `sync/snapshot.ts`, which the Next routes also call.
 * That is what keeps two live servers from answering the same flush
 * differently.
 *
 * Deliberately NOT rate limited, unlike the auth routes (A9, rubric B3). A
 * throttled sync loses a farm's morning; the batch cap, the token, the role
 * check and Zod are the controls here.
 */
export async function syncRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.post('/sync', async (request, reply) => {
    // Identity, org and role are re-derived before anything is read.
    const claims = await requireMutationClaims(request.headers.authorization, env.AUTH_SECRET);
    const scope = await scoped(claims.orgId);

    // Never a bare 200: the body is a per-mutation result array, because a
    // batch can be partly applied and the client has to know exactly which
    // entries to clear and which to route to the rejected inbox (A6).
    return reply.status(200).send(await handleSyncBatch(scope, claims, request.body));
  });

  app.get('/snapshot', async (request, reply) => {
    // Read-only, so the token alone is enough — there is no mutation here to
    // re-derive a role for. Tenancy is the scoped layer's job, as always.
    const claims = await requireClaims(request.headers.authorization, env.AUTH_SECRET);
    const scope = await scoped(claims.orgId);

    const query = request.query as Record<string, string | undefined>;
    const cursor = parseSnapshotCursor(query.since ?? null, query.sinceId ?? null);

    return reply.status(200).send(await readSnapshotPage(scope, cursor));
  });
}
