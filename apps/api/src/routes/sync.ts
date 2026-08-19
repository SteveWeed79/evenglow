import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CLIENT_VERSION_HEADER, isClientTooOld, syncRefusalMessage } from '@homefarm/contracts';
import { requireClaims, requireMutationClaims } from '../auth/require';
import { syncAccess } from '../billing/access';
import { findOrgById, recordLastSeen } from '../db/identity';
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
 * `sync/batch.ts` and `sync/snapshot.ts`. That began as a way to keep two live
 * servers in step and is kept because it is what makes the whole write path
 * testable without a port.
 *
 * Deliberately NOT rate limited, unlike the auth routes (A9, rubric B3). A
 * throttled sync loses a farm's morning; the batch cap, the token, the role
 * check and Zod are the controls here.
 */
/**
 * What build said this, as a header and nothing more.
 *
 * A repeated header arrives as an array. Two answers to "which build is this"
 * is not one this server should pick between, and an array is not a version —
 * both the floor and the record read that as no version at all.
 */
function reportedVersion(request: FastifyRequest): string | undefined {
  const said = request.headers[CLIENT_VERSION_HEADER];
  return typeof said === 'string' ? said : undefined;
}

/**
 * Writes down what is running out there, on the two routes the fleet uses.
 *
 * **Not awaited, and that is the whole design.** A farm's sync must not wait on
 * bookkeeping, and it must not fail on it either; `recordLastSeen` swallows its
 * own errors and this drops the promise on purpose. Nothing downstream reads
 * the result, so there is nothing to sequence.
 *
 * Both routes rather than just `/sync`, because a device that is only pulling
 * is still a device in the field — a reinstall restoring a farm reports its
 * build for a while before it writes anything, and that is exactly the moment
 * somebody would want to know what it is running.
 */
function noteClientVersion(request: FastifyRequest, userId: string): void {
  void recordLastSeen(userId, reportedVersion(request), new Date());
}

export async function syncRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.post('/sync', async (request, reply) => {
    // Identity, org and role are re-derived before anything is read.
    const claims = await requireMutationClaims(request.headers.authorization, env.AUTH_SECRET);

    // After the token is verified and before anything can turn the request
    // away: a build refused for being too old is precisely one worth having a
    // record of, and a farm held at a 402 is still a farm running something.
    noteClientVersion(request, claims.userId);

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
     *
     * ## A server that takes no payments does not charge for anything
     *
     * **Without this, a self-hosted Evenglow is a server nobody can ever sync
     * to.** There is no Play Console behind somebody's own box, so no farm on
     * it can subscribe, so the gate would refuse every flush forever — and
     * `ACCESS-AND-BILLING.md` is built around exactly that box. The billing
     * routes already answer 501 when unconfigured; this is the same fact read
     * from the other end.
     *
     * It is also the honest reading of D13. The subscription pays for *this
     * project* to hold a farm's records. A farm holding its own records on its
     * own hardware owes nobody anything, and a gate that charged it would be
     * charging for someone else's electricity.
     */
    /**
     * A granted farm is never asked (D13).
     *
     * Checked before the rail rather than after, so it holds whatever the
     * store says about a farm — including nothing at all. That ordering is the
     * point: this is for testers and for the people building the app, who have
     * no purchase to reconcile and should never see a 402 because a Play
     * sandbox had an opinion.
     *
     * Read from the server's own environment; nothing on the wire reaches it.
     */
    /**
     * Old enough to misread the wire, told so in a sentence ([23], [24]).
     *
     * Before the entitlement, because the two answers are about different
     * things and this one is cheaper: a build that cannot model what the farm
     * now holds should hear about that rather than about a subscription. It is
     * also the honest order — a farm whose app is out of date and whose card
     * has lapsed has two problems, and the one it can fix in a minute goes
     * first.
     *
     * A 426 rather than a 4xx the client would treat as a rejection: nothing
     * here is wrong with the mutations. The body carries the same shape a 402
     * does, so the client holds the batch through machinery that already
     * exists rather than a second path that has to agree with it.
     */
    if (isClientTooOld(reportedVersion(request), env.minimumClientVersion)) {
      return reply
        .status(426)
        .send({ error: syncRefusalMessage('appTooOld'), refusal: 'appTooOld' });
    }

    {
      const entitlement = syncAccess(env, await findOrgById(claims.orgId));

      if (!entitlement.syncing && entitlement.refusal !== null) {
        // The reason travels beside the sentence so the client can persist
        // which state it is in without parsing prose. The sentence is for a
        // person; the code is for the chip.
        return reply
          .status(402)
          .send({ error: syncRefusalMessage(entitlement.refusal), refusal: entitlement.refusal });
      }
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
    noteClientVersion(request, claims.userId);

    const scope = await scoped(claims.orgId);

    const query = request.query as Record<string, string | undefined>;
    const cursor = parseSnapshotCursor(query.since ?? null, query.sinceId ?? null);

    return reply.status(200).send(await readSnapshotPage(scope, cursor));
  });
}
