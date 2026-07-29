import type { FastifyInstance } from 'fastify';
import { type PullResponse, PULL_PAGE_SIZE, type PulledMutation } from '@steading/contracts';
import { requireAuth } from '../auth/guard';
import { scoped, type Tenanted } from '../db/scoped';
import { errorResponse, HttpError } from '../http';

/**
 * GET /snapshot?since=<serverTs> — the read half of sync.
 *
 * Without this the app is single-device: a reinstall, or a second phone, opens
 * to an empty farm even though the server holds everything. It replays the
 * org's mutation log, which is why the log is never pruned — it is the only
 * thing that can rebuild a device.
 *
 * Paged by `serverTs`, the global ordering stamp. `clientTs` cannot serve as a
 * cursor: it comes from device clocks, which are not trusted (D6), and a phone
 * with a wrong date would skip or replay history forever.
 */

interface MutationDoc extends Tenanted {
  _id: string;
  schemaVersion: number;
  targetId: string;
  entity: string;
  op: string;
  payload: unknown;
  deviceId: string;
  clientSeq: number;
  clientTs: number;
  serverTs: Date;
}

export function registerSnapshotRoutes(app: FastifyInstance): void {
  app.get('/snapshot', async (request, reply) => {
    try {
      const claims = await requireAuth(request);

      const raw = (request.query as { since?: string } | undefined)?.since;
      const since = parseSince(raw);

      const scope = await scoped(claims.orgId);

      // One extra row is the cheapest way to know whether more remain without
      // a second count query.
      const docs = await scope.col<MutationDoc>('mutations').findMany(
        { serverTs: { $gt: new Date(since) } } as never,
        { limit: PULL_PAGE_SIZE + 1, sort: { serverTs: 1 } },
      );

      const more = docs.length > PULL_PAGE_SIZE;
      const page = more ? docs.slice(0, PULL_PAGE_SIZE) : docs;

      const mutations: PulledMutation[] = page.map((doc) => ({
        schemaVersion: doc.schemaVersion,
        id: doc._id,
        targetId: doc.targetId,
        entity: doc.entity as PulledMutation['entity'],
        op: doc.op as PulledMutation['op'],
        payload: doc.payload,
        deviceId: doc.deviceId,
        clientSeq: doc.clientSeq,
        clientTs: doc.clientTs,
        serverTs: doc.serverTs.getTime(),
      }));

      // The watermark never runs ahead of what was actually sent. Advancing it
      // to "now" would skip anything committed between the query and the
      // response, and the device would never ask for it again.
      const through = mutations.at(-1)?.serverTs ?? since;

      const body: PullResponse = { mutations, through, more };
      return await reply.send(body);
    } catch (error) {
      const { status, body } = errorResponse(error);
      return reply.status(status).send(body);
    }
  });
}

/**
 * A malformed cursor is a 400, not a default.
 *
 * Treating an unreadable `since` as zero would silently ship the org's entire
 * history on every request from a buggy client — expensive, and it hides the
 * bug.
 */
function parseSince(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 0;

  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new HttpError(400, 'That sync cursor could not be read.');
  }

  return value;
}
