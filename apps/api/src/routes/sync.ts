import type { FastifyInstance } from 'fastify';
import { entitlementOf, syncRefusalMessage } from '@steading/contracts';
import { requireClaims, requireMutationClaims } from '../auth/require';
import { findOrgById } from '../db/identity';
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

    /**
     * What a subscription buys, and this is the only place it is spent (D13).
     *
     * **Writing is the paid thing**, because writing is what makes the server
     * hold a farm's records. Nothing above this line has cost anything: the
     * whole app runs on the handset, and a farm that never subscribes uses
     * every feature forever on the one device.
     *
     * A **402**, not a 4xx with results and not a 403. The client treats it
     * like being offline — everything stays queued, no attempt is counted, and
     * nothing reaches the rejected inbox. That distinction is the load-bearing
     * one: a rejection is something a person must look at, and there is
     * nothing here for anybody to look at.
     */
    const entitlement = entitlementOf((await findOrgById(claims.orgId))?.subscription, Date.now());
    if (!entitlement.syncing && entitlement.refusal !== null) {
      // The reason travels beside the sentence so the client can persist which
      // state it is in without parsing prose. The sentence is for a person;
      // the code is for the chip.
      return reply
        .status(402)
        .send({ error: syncRefusalMessage(entitlement.refusal), refusal: entitlement.refusal });
    }

    const scope = await scoped(claims.orgId);

    // Never a bare 200: the body is a per-mutation result array, because a
    // batch can be partly applied and the client has to know exactly which
    // entries to clear and which to route to the rejected inbox (A6).
    return reply.status(200).send(await handleSyncBatch(scope, claims, request.body));
  });

  /**
   * Pulling is deliberately NOT gated on a subscription.
   *
   * A farm's records are the farm's, and a lapsed subscription must never be
   * the reason it cannot get them back — that is precisely the trap the export
   * exists to prevent, one layer in. Somebody whose card expired and who then
   * drops their phone in a trough has to be able to reinstall and recover.
   *
   * The value of read-only sync on its own is small enough that this is not a
   * hole to walk through: nothing can be logged, so a farm using it is a farm
   * reading a frozen copy of its own history.
   */
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
