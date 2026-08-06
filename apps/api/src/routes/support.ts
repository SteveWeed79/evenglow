import type { FastifyInstance } from 'fastify';
import { supportTicketSchema } from '@steading/contracts';
import { fileTicket } from '../support/github';
import type { Env } from '../env';

/**
 * Where a ticket lands (`docs/SUPPORT-LOOP.md`).
 *
 * **Unauthenticated, deliberately.** The farm most in need of reporting is the
 * one whose sync is refusing it, and a support route behind the same token as
 * the thing that is broken is a support route that cannot be used on the
 * morning it matters. A ticket carries no authority and asks for nothing; the
 * worst a stranger can do with this route is file an issue, which is what a
 * stranger can already do on GitHub.
 *
 * Rate limited hard for exactly that reason, and it fails closed like sign-in:
 * a throttled report costs somebody a minute, and an unthrottled one is an
 * issue tracker anybody can flood.
 */
export async function supportRoutes(app: FastifyInstance, env: Env): Promise<void> {
  await app.register(async (scope) => {
    /**
     * Five a minute per address.
     *
     * The device already deduplicates by fingerprint and holds tickets in a
     * queue, so an honest farm never approaches this even in a crash loop —
     * it is here for somebody who is not a farm.
     */
    await scope.register(import('@fastify/rate-limit'), { max: 5, timeWindow: '1 minute' });

    scope.post('/support', async (request, reply) => {
      const config = env.supportConfig;
      if (config === null) {
        /**
         * A server with no issue tracker configured says so plainly, because
         * the app has a second door and needs to know to offer it.
         *
         * 501 rather than a silent success: a farm told its report was sent
         * when it was not is worse off than one told to use the share sheet.
         */
        return reply.status(501).send({ error: 'This server has nowhere to file a report.' });
      }

      const parsed = supportTicketSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'That report could not be read.' });
      }

      const { bundle, records } = parsed.data;

      /**
       * The opt-in half, refused while the repository is public (S5).
       *
       * Answered rather than silently dropped: the farm was asked a question
       * and said yes, and it is owed the truth about what happened to the
       * answer. The lean bundle still files, because the report is still
       * worth having.
       */
      const recordsRefused = records !== undefined && !config.acceptRecords;

      try {
        const filed = await fileTicket(config, bundle, recordsRefused ? undefined : records);

        return reply.status(200).send({
          ok: true,
          url: filed.url,
          created: filed.created,
          ...(recordsRefused
            ? { note: 'Your records were not sent — this tracker cannot accept them yet.' }
            : {}),
        });
      } catch {
        /**
         * The tracker was unreachable.
         *
         * A 502 rather than a 200, because the device holds the ticket until
         * it is sent and a false success would drop the one artefact the whole
         * loop exists to move. The queue retries; the share sheet is the other
         * way out.
         */
        return reply.status(502).send({ error: 'Could not file that report. It is still on your phone.' });
      }
    });
  });
}
