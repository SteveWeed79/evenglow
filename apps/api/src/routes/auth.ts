import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeCredentials } from '../auth/credentials';
import { requireAuth } from '../auth/guard';
import { resolvePrincipal, UnauthorizedError } from '../auth/principal';
import { issueTokenPair, rotateRefreshToken } from '../auth/tokens';
import { revokeAllForUser } from '../db/sessions';
import { errorResponse, HttpError } from '../http';

/**
 * Sign-in, refresh, sign-out.
 *
 * Tokens go back in the response body rather than a cookie: the client is an
 * APK, not a browser session, and it stores them in the platform keystore
 * (invariant 6). A cookie would also make the sync endpoints CSRF-shaped for
 * no benefit.
 */

const loginSchema = z
  .object({
    email: z.string().email().max(320),
    password: z.string().min(1).max(1024),
  })
  .strict();

const refreshSchema = z.object({ refreshToken: z.string().min(1).max(512) }).strict();

export function registerAuthRoutes(app: FastifyInstance): void {
  /**
   * Sign-in is the credential-stuffing surface, so it gets a far tighter
   * budget than the global one. Ten a minute is generous for a person and
   * useless for a list.
   */
  app.post('/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    try {
      const parsed = loginSchema.safeParse(request.body);
      // One message for every failure — malformed, unknown email, wrong
      // password, disabled account — so the response cannot be used to work
      // out which emails have accounts.
      if (!parsed.success) throw new HttpError(401, 'That email and password did not match.');

      const user = await authorizeCredentials(parsed.data);
      if (!user) throw new HttpError(401, 'That email and password did not match.');

      const tokens = await issueTokenPair({
        userId: user.id,
        orgId: user.orgId,
        role: user.role,
      });

      return await reply.send({
        ...tokens,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      });
    } catch (error) {
      const { status, body } = errorResponse(error);
      return reply.status(status).send(body);
    }
  });

  app.post('/auth/refresh', async (request, reply) => {
    try {
      const parsed = refreshSchema.safeParse(request.body);
      if (!parsed.success) throw new HttpError(401, 'Sign in again.');

      const tokens = await rotateRefreshToken(parsed.data.refreshToken, async (userId) => {
        try {
          return await resolvePrincipal(userId);
        } catch (error) {
          // A user disabled or deleted since sign-in cannot refresh their way
          // back in, however valid the token they hold.
          if (error instanceof UnauthorizedError) throw new HttpError(401, error.message);
          throw error;
        }
      });

      return await reply.send(tokens);
    } catch (error) {
      const { status, body } = errorResponse(error);
      return reply.status(status).send(body);
    }
  });

  /**
   * Revokes every refresh token this user holds.
   *
   * Outstanding access tokens stay valid until they expire — that is the cost
   * of stateless access tokens, and fifteen minutes is the bound. The client
   * wipes local data on sign-out regardless (C5), so nothing on the device
   * outlives the session either way.
   */
  app.post('/auth/logout', async (request, reply) => {
    try {
      const claims = await requireAuth(request);
      await revokeAllForUser(claims.userId);
      return await reply.status(204).send();
    } catch (error) {
      const { status, body } = errorResponse(error);
      return reply.status(status).send(body);
    }
  });
}
