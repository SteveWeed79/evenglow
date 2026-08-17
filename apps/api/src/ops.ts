import { readEnv } from './env';
import { buildOpsServer } from './ops/server';

/**
 * `pnpm ops` — the operations board, as its own process.
 *
 * Its own entry point rather than a flag on the API's, so the two are separate
 * units to systemd: the board can be restarted, stopped, or never started at
 * all without touching the service farms are syncing to. A box that does not
 * run this file has no admin surface on it whatsoever, which is the strongest
 * version of the deployment being a decision.
 *
 * **Bind to loopback by default.** The API listens on `0.0.0.0` because it must
 * be reachable; this must not be, unless a proxy in front of it says so. Caddy
 * talks to it over localhost, and a box whose Caddy config does not mention the
 * board is a box where nothing outside can reach it — no firewall rule
 * required, and no way to forget one.
 *
 * `OPS_HOST=0.0.0.0` is there for a container, where loopback means the
 * container's own and a published port would otherwise reach nothing. Setting
 * it on a bare host is the deliberate act of putting the board on the network.
 */

const env = readEnv();
const app = await buildOpsServer(env);
const host = process.env.OPS_HOST ?? '127.0.0.1';

await app.listen({ port: env.OPS_PORT, host });
console.log(`steading operations board on ${host}:${env.OPS_PORT}`);

/**
 * The same clean-shutdown handling the API has, and for the same reason: a unit
 * killed for not answering SIGTERM fills the journal with failures that are not
 * failures, and a real one then has somewhere to hide.
 */
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}
