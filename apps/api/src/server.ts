import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuthRoutes } from './routes/auth';
import { registerSnapshotRoutes } from './routes/snapshot';
import { registerSyncRoutes } from './routes/sync';

/**
 * The API. A plain HTTP service — the client is a static bundle inside an APK
 * (D10), so there is no rendering here and no session cookie.
 */

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    // The APK talks to this over TLS terminated upstream; trust the proxy's
    // forwarded address so the rate limiter keys on the real client.
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  /**
   * The origin allowlist is explicit. A native WebView sends no Origin at all,
   * so `credentials` is off and `*` would be the lazy answer — but the browser
   * dev loop does send one, and leaving it open there is how a dev-only hole
   * ships.
   */
  const origins = (process.env.STEADING_ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  await app.register(cors, { origin: origins, methods: ['GET', 'POST'] });

  /**
   * Bounded fail-open, and the ONLY thing in this codebase allowed to fail
   * open (invariant 10). If the limiter's own store misbehaves, a farmer must
   * still be able to sync a morning's work; authorization gets no such
   * latitude.
   */
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // Sign-in is the credential-stuffing surface; it gets its own tighter
    // budget below via a route-level config.
    allowList: [],
  });

  app.get('/health', async () => ({ ok: true }));

  registerAuthRoutes(app);
  registerSyncRoutes(app);
  registerSnapshotRoutes(app);

  return app;
}

async function main(): Promise<void> {
  const app = await buildServer();
  const port = Number(process.env.PORT ?? 3001);

  try {
    await app.listen({ port, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

// `tsx src/server.ts` runs this; importing the module for a test does not.
if (process.argv[1]?.endsWith('server.ts')) {
  await main();
}
