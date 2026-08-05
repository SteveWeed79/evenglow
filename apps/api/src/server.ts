import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { type Env, readEnv } from './env';
import { errorBody } from './http';
import { authRoutes } from './routes/auth';
import { billingRoutes } from './routes/billing';
import { memberRoutes } from './routes/members';
import { photoRoutes } from './routes/photos';
import { supportRoutes } from './routes/support';
import { syncRoutes } from './routes/sync';

/**
 * The Fastify service (D10).
 *
 * Runs alongside the Next route handlers for now. Both are thin adapters over
 * the same appliers in this package, which is what keeps them from answering
 * the same request differently while both are serving. The Next surface goes
 * away in S7.
 */

export async function buildServer(env: Env = readEnv()): Promise<FastifyInstance> {
  const app = Fastify({
    // Trust the proxy for client IPs, or every request rate-limits against the
    // same address and the auth limiter protects nothing.
    trustProxy: true,
    logger: false,
  });

  await app.register(import('@fastify/cors'), {
    origin: env.corsOrigins,
    credentials: true,
  });

  /**
   * One error shape for the whole service, and never the raw message.
   *
   * An unhandled error can carry query shape or schema detail, and this
   * service answers a client that ships inside an APK — anyone can read what
   * it sends. errorBody is shared with the Next adapter so the two cannot
   * describe the same failure differently.
   */
  app.setErrorHandler((error, _request, reply) => {
    const { status, body } = errorBody(error);
    return reply.status(status).send(body);
  });

  app.get('/health', async () => ({ ok: true }));

  await authRoutes(app, env);
  await billingRoutes(app, env);
  await memberRoutes(app, env);
  await supportRoutes(app, env);
  await syncRoutes(app, env);
  await photoRoutes(app, env);

  return app;
}

/**
 * Started only when run directly, so importing this module in a test does not
 * bind a port. Compared by resolved path: matching on filename alone would
 * also fire for any other server.ts that happened to be the entry point.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const env = readEnv();
  const app = await buildServer(env);
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  console.log(`steading api listening on :${env.PORT}`);
}
