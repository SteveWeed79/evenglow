import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeCredentials } from '../auth/credentials';
import { endSession, rotateSession, startSession } from '../auth/refresh';
import type { Env } from '../env';
import { errorBody, HttpError } from '../http';

/**
 * Sign-in, refresh, sign-out.
 *
 * Rate limiting on these routes fails CLOSED (rubric B3), which is the
 * opposite of the sync path. A sync that is throttled loses a farm's work; a
 * login that is throttled loses an attacker's next guess.
 */

/**
 * No login schema here on purpose. `authorizeCredentials` parses its own input
 * and returns null on anything malformed, and it is shared with the Auth.js
 * provider — a second schema in this file would be the same shape declared
 * twice, which is how the two sign-in paths would come to disagree about what
 * counts as a valid credential.
 */
const refreshSchema = z.object({ refreshToken: z.string().min(1) }).strict();

export async function authRoutes(app: FastifyInstance, env: Env): Promise<void> {
  /**
   * Five attempts a minute per IP. Deliberately not per-email: keying on a
   * submitted identifier lets an attacker spread guesses across accounts and
   * never trip the limit, and it lets them lock a known user out by
   * exhausting that user's bucket.
   */
  await app.register(async (scope) => {
    await scope.register(import('@fastify/rate-limit'), {
      max: 5,
      timeWindow: '1 minute',
    });

    scope.post('/auth/login', async (request, reply) => {
      const user = await authorizeCredentials(request.body);
      if (!user) {
        // One answer for every failure — unknown email, wrong password,
        // disabled account, malformed body. Distinguishing them turns this
        // route into an account enumerator.
        return reply.status(401).send({ error: 'That email or password is not right.' });
      }

      const pair = await startSession(
        { userId: user.id, orgId: user.orgId, role: user.role },
        env.AUTH_SECRET,
      );
      /**
       * The name comes back with the tokens, and the reason is notes.
       *
       * The access token carries `sub`, `orgId` and `role` and deliberately no
       * display name — a name is not an authorization claim and does not
       * belong in something re-verified on every request. But a note written
       * in a barn has to be able to say who wrote it on the other person's
       * phone, and a device with no signal cannot look one up. So it is
       * handed over once, here, and cached.
       */
      return reply.status(200).send({ ...pair, user: { id: user.id, name: user.name, role: user.role } });
    });

    scope.post('/auth/refresh', async (request, reply) => {
      const parsed = refreshSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(401).send({ error: 'Your session has expired. Sign in again.' });
      }

      try {
        return reply.status(200).send(await rotateSession(parsed.data.refreshToken, env.AUTH_SECRET));
      } catch (error) {
        const { status, body } = errorBody(error);
        return reply.status(status).send(body);
      }
    });
  });

  /**
   * Not rate limited, and not authenticated either: a client that cannot sign
   * out is a client that keeps a live refresh token. Presenting the token is
   * the only credential this needs, and the worst a stranger can do with one
   * is end the session it already belongs to.
   */
  app.post('/auth/logout', async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'That request is missing a session to end.');

    await endSession(parsed.data.refreshToken);
    return reply.status(204).send();
  });
}
