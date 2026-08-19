import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { ping } from './db/client';
import { type Env, readEnv } from './env';
import { setSecurityHeaders } from './headers';
import { errorBody } from './http';
import { authRoutes } from './routes/auth';
import { billingRoutes } from './routes/billing';
import { memberRoutes } from './routes/members';
import { photoRoutes } from './routes/photos';
import { supportRoutes } from './routes/support';
import { syncRoutes } from './routes/sync';
import { startSweeper } from './sync/sweep';

/**
 * The Fastify service (D10).
 *
 * The only server. It is a thin adapter over the appliers in this package —
 * every rule about what is accepted and what is refused lives in `sync/` and
 * `db/`, and this file parses a request, hands it over, and sends what comes
 * back.
 *
 * That separation was built when a Next surface ran beside this one, and it
 * outlived it: the Next app is deleted (`CLAUDE.md`), and the seam is worth
 * keeping because it is what made removing a whole server a deletion rather
 * than a rewrite.
 */

export async function buildServer(env: Env = readEnv()): Promise<FastifyInstance> {
  const app = Fastify({
    /**
     * Believe `X-Forwarded-For` only as far as the proxies we actually run.
     *
     * `true` here meant believing it from anyone, and `request.ip` is what
     * every rate limiter in this service keys on — so one forged header per
     * attempt gave each guess its own address and the auth limiter never
     * fired. A number tells Fastify to take the address that many hops from
     * the right, which a caller cannot forge past. Zero (the default) trusts
     * nothing, which is correct for a service reachable directly.
     *
     * See `TRUSTED_PROXY_HOPS` in env.ts for why this cannot be inferred.
     */
    trustProxy: env.TRUSTED_PROXY_HOPS > 0 ? env.TRUSTED_PROXY_HOPS : false,
    logger: false,
  });

  await app.register(import('@fastify/cors'), {
    origin: env.corsOrigins,
    credentials: true,
  });

  /**
   * Set on everything, including a 500 and a 404.
   *
   * Most of what these buy does not apply to a service answering an APK, and
   * that is the argument that kept them off — it was three-quarters right. The
   * quarter it missed is `/photos/:id`, which serves bytes a farm account
   * uploaded, where `nosniff` is what stops a client guessing at what they are.
   * See `headers.ts`.
   */
  setSecurityHeaders(app);

  /**
   * One error shape for the whole service, and never the raw message.
   *
   * An unhandled error can carry query shape or schema detail, and this
   * service answers a client that ships inside an APK — anyone can read what
   * it sends. `errorBody` is the one place a failure becomes a response, so
   * nothing in this service can describe the same condition two ways.
   */
  app.setErrorHandler((error, _request, reply) => {
    const { status, body } = errorBody(error);
    return reply.status(status).send(body);
  });

  /**
   * Liveness and readiness are different questions, and only one was asked.
   *
   * `/health` answers *is this process running*. It touches nothing, and it
   * stays that way: `fly.toml` gates a machine restart on it, and restarting
   * the process because the database is slow is the wrong cure for the wrong
   * fault.
   *
   * `/ready` answers *can this process serve a request*, which needs the
   * database — because Mongo connects lazily (`db/client.ts`). `env.ts`
   * requires `MONGODB_URI` to be non-empty, so a *missing* one stops the boot,
   * but a *wrong* one (unreachable host, rejected credentials) does not. The
   * process comes up, `/health` returns `{ok:true}`, and every data route fails
   * at a five-second server-selection timeout. `deploy.sh` polled `/health`
   * after each restart and its own comment said the poll existed to catch "a
   * bad `MONGODB_URI`" — which is the one thing it could not do.
   */
  app.get('/health', async () => ({ ok: true }));

  app.get('/ready', async (_request, reply) => {
    try {
      await ping();
    } catch {
      /**
       * The reason goes to the journal, never to the caller. This is
       * unauthenticated and reachable from the internet, and a Mongo
       * connection error carries the hostname, the replica set name and
       * sometimes the username.
       */
      return reply.status(503).send({ ok: false, database: 'unreachable' });
    }
    return { ok: true, database: 'reachable' };
  });

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

  /**
   * Here rather than in `buildServer`, so importing this module in a test binds
   * no port and starts no timer — the same reason the listen itself is here.
   *
   * A record logged at the moment a phone dies is stamped `pending`, and
   * `pending` is withheld from the feed, so without this it reaches no other
   * device on the farm for ever. See `sync/sweep.ts`.
   */
  startSweeper();

  /**
   * Stop when asked, rather than being killed for not answering.
   *
   * **Every clean restart was being recorded as a failure**, which is the sort
   * of thing that costs nothing until the day it matters:
   *
   *   steading-api.service: Main process exited, code=exited, status=143/n/a
   *   steading-api.service: Failed with result 'exit-code'.
   *
   * 143 is 128 + SIGTERM. Node installs no handler for it, so the default
   * action terminates the process and systemd sees a non-zero exit. Nothing
   * was wrong — that was `systemctl restart` — but `deploy.sh` restarts on
   * every deployment, so the journal fills with failures that are not failures
   * and a real one has somewhere to hide.
   *
   * Closing Fastify rather than exiting immediately is the part worth having:
   * it stops accepting new connections and lets in-flight requests finish. A
   * sync flush killed halfway is not a correctness problem — every mutation
   * carries a ULID and applies once — but the device would take the dropped
   * connection as a failed batch and retry all hundred of them.
   *
   * `once`, so a second signal during shutdown falls through to the default
   * action and kills it. If closing hangs, the operator holding Ctrl-C twice
   * should be obeyed, and systemd's TimeoutStopSec is the backstop.
   */
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void app
        .close()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  }
}
