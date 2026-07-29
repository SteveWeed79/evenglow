import type { FastifyInstance } from 'fastify';
import { type SyncResponse, syncRequestSchema } from '@steading/contracts';
import { requireAuth } from '../auth/guard';
import { scoped } from '../db/scoped';
import { errorResponse, HttpError } from '../http';
import { applyBatch } from '../sync/apply';

/**
 * POST /sync — the flush endpoint.
 *
 * Never a bare 200. The response is a per-mutation result array, because a
 * batch is not an all-or-nothing unit: one mutation the caller's role cannot
 * make must not strand the rest of a morning's work behind it.
 */
export function registerSyncRoutes(app: FastifyInstance): void {
  app.post('/sync', async (request, reply) => {
    try {
      const claims = await requireAuth(request);

      const parsed = syncRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        // `.strict()` on the schema is doing security work here: a
        // payload-supplied orgId is a hard 400, never a silently ignored
        // field (invariant 2).
        throw new HttpError(400, parsed.error.issues[0]?.message ?? 'That batch could not be read.');
      }

      // orgId comes from the verified principal, which came from the user
      // document — not from anything on the wire.
      const scope = await scoped(claims.orgId);
      const results = await applyBatch(scope, claims, parsed.data.mutations);

      const body: SyncResponse = { results, serverTs: Date.now() };
      return await reply.send(body);
    } catch (error) {
      const { status, body } = errorResponse(error);
      return reply.status(status).send(body);
    }
  });
}
