import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authorizeCredentials } from '../auth/credentials';
import { bearerFrom, mintAccessToken, verifyAccessToken } from '../auth/tokens';
import { farmSyncState } from '../billing/access';
import { readBoard } from '../db/board';
import { findUserById } from '../db/identity';
import { type Env, readEnv } from '../env';
import { boardPolicy, setSecurityHeaders } from '../headers';
import { errorBody, HttpError } from '../http';
import { readSweep } from '../db/sweep-status';
import { actionGrant, actionNewPromo } from './actions';
import { boardPage } from './page';

/**
 * The operations board — a separate process, on its own port, behind Caddy.
 *
 * ## Why it is not a route on the API
 *
 * The API is the surface every handset talks to, reachable from the internet by
 * design, and this is the one thing on the box that reads every farm. Bolting
 * it on would mean the admin surface shares a hostname, a CORS policy and an
 * error handler with the app's own traffic, and that the way to stop serving it
 * is a code change. On its own port it is a Caddy site block, and taking it off
 * the internet is one line in a config file.
 *
 * It is the same process image and the same functions — `db/board.ts`,
 * `db/farms.ts`, `ops/actions.ts` — so the board and the commands cannot come
 * to different answers. What differs is who can reach it.
 *
 * ## Auth, and the three conditions on it
 *
 * A **password on the existing `admin` role**. Not a second auth system:
 * `ROLES` already has `owner | admin | hand`, `authorizeCredentials` is the one
 * path no user avoids, and this reuses both. An admin account is made the way
 * any account is made and its password comes out of a manager, never typed —
 * the whole thing rests on that entropy.
 *
 * **Its own rate limiter.** The existing registrations are per-route
 * `scope.register` calls, so a new route inherits nothing; sign-in here gets
 * its own or it has none.
 *
 * **`TRUSTED_PROXY_HOPS` set correctly on the box.** `DEPLOY-THE-SERVER.md`
 * records what happens when it is wrong: `request.ip` is `127.0.0.1` for every
 * request and every limiter in the service shares one bucket, which would make
 * the limiting decorative and reduce this to a password alone. It is read from
 * the same env as the API, so a box that got it right for one has it right for
 * both.
 *
 * ## The token lives in the page, not in a cookie
 *
 * Sign-in answers with an access token and the page holds it in a variable.
 * **No cookie, deliberately**: an ambient credential the browser attaches to
 * every request is a CSRF surface that would then need its own defence, and
 * this way there is nothing to forge a request with. It also means no new
 * dependency — `@fastify/cookie` is not installed and this does not install it.
 *
 * The cost is that a refresh signs you out, because the token was only ever in
 * memory. For a board somebody opens to answer a question, that is the right
 * trade; the fifteen-minute access token expiry would land in much the same
 * place anyway.
 */

const signInRequest = z
  .object({ email: z.string().email().max(320), password: z.string().min(1).max(1024) })
  .strict();

/**
 * An admin, or nobody.
 *
 * Re-derived from the token on every request rather than trusted from sign-in
 * (invariant 8), and the role is checked here rather than assumed from the fact
 * that a token exists — every farmer on the server has one of those.
 */
async function requireAdmin(request: FastifyRequest, env: Env): Promise<void> {
  const token = bearerFrom(request.headers.authorization);
  if (token === null) throw new HttpError(401, 'Sign in.');

  const claims = await verifyAccessToken(token, env.AUTH_SECRET);

  /**
   * And then asked of the database, because the line above reads a token.
   *
   * **This was the whole check, and that is invariant 8 inverted**: cached
   * claims gate local UX, and the server re-derives identity and role on every
   * mutation. Two of the routes below *are* mutations — one gives a farm free
   * sync, the other mints a subscription code — so an administrator demoted or
   * removed a minute ago kept both for the fifteen minutes an access token
   * lives. Nowhere else on this server does that; `requireMutationClaims` has
   * re-read the user on every write since it was written, and this is the same
   * read for the same reason.
   *
   * Not `requireMutationClaims` itself, deliberately. That one also insists the
   * token's `orgId` still matches the user's, which is right for a
   * tenant-scoped write and wrong here — the board is the one surface that is
   * about no farm in particular, and somebody who moved farms should not lose
   * the server's operations page because of it.
   *
   * A disabled account gets the 401, not the 403 above: it is not a role
   * problem, and "sign in again" is the only thing to do about it.
   */
  const user = await findUserById(claims.userId);
  if (user === null || user.disabledAt !== undefined) {
    throw new HttpError(401, 'That account is no longer active.');
  }

  /**
   * The operator flag, **not** the farm role — and the first version of this
   * checked the role.
   *
   * `admin` is a farm's manager. `assignableRoles('owner')` returns all three
   * roles and `assignableRoles('admin')` returns `['admin', 'hand']`, so any
   * farm owner could mint one and any admin could mint another — and that
   * account would have opened this board, read every farm on the server,
   * granted free sync and minted subscription codes. Cross-tenant escalation
   * from an ordinary Members screen, on the one surface `scoped()` deliberately
   * does not protect.
   *
   * `operatorSince` is set by `pnpm ops:admin` and by nothing else. No route
   * writes it, no payload schema carries it, and it is not in the access token
   * — which is why this is a database read rather than a claim. See
   * `db/identity.ts`.
   *
   * **A 403 rather than a 404, and this is the one place that ordering flips.**
   * Everywhere else an unauthorised read is a 404, because distinguishing them
   * discloses that a record exists. There is no record here — the board is a
   * fixed page — so there is nothing to disclose, and telling somebody who
   * signed in correctly that their account is not an operator is more useful
   * than pretending the page is missing.
   */
  if (user.operatorSince === undefined) {
    throw new HttpError(403, 'That account is not an operator of this server.');
  }
}

export async function buildOpsServer(env: Env = readEnv()): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: env.TRUSTED_PROXY_HOPS > 0 ? env.TRUSTED_PROXY_HOPS : false,
    logger: false,
  });

  // The same one shape as the API, and never a raw message: this process talks
  // to a browser and an unhandled error carries query and schema detail.
  app.setErrorHandler((error, _request, reply) => {
    const { status, body } = errorBody(error);
    return reply.status(status).send(body);
  });

  /**
   * No CORS registration at all, which is itself the policy.
   *
   * The page is served by this process and talks only to this process, so
   * same-origin covers everything it does. Registering permissive CORS here
   * would be handing every site the browser visits a way to call the board with
   * whatever credentials it can get hold of.
   */

  setSecurityHeaders(app);

  app.get('/', async (_request, reply) => {
    /**
     * A fresh nonce per response, from the CSPRNG.
     *
     * The point of a nonce is that an injected `<script>` cannot carry one, so
     * it has to be unguessable and it has to be new — a nonce reused across
     * responses is a value an attacker can read out of one page and write into
     * the next. 128 bits, base64url, which is what the CSP grammar takes
     * without escaping.
     *
     * The page renders every value through `textContent` already, and that is
     * still the thing doing the work. This is the layer underneath: if one of
     * those ever became an `innerHTML`, this is what stops the result running.
     */
    const nonce = randomBytes(16).toString('base64url');

    return reply
      .type('text/html; charset=utf-8')
      .header('content-security-policy', boardPolicy(nonce))
      .send(boardPage(nonce));
  });

  /** Liveness for the unit file. Touches nothing, says nothing about a farm. */
  app.get('/health', async () => ({ ok: true }));

  await app.register(async (scope) => {
    /**
     * Five a minute, which is the same ceiling `/support` and `/billing` use.
     *
     * Its own registration, because Fastify's plugin encapsulation means a
     * limiter registered on another scope does not apply here — the existing
     * ones are per-route `scope.register` calls and a new route inherits none
     * of them.
     */
    await scope.register(import('@fastify/rate-limit'), { max: 5, timeWindow: '1 minute' });

    scope.post('/session', async (request, reply) => {
      const parsed = signInRequest.safeParse(request.body);
      /**
       * One answer for every failure — bad shape, unknown address, wrong
       * password, right password on a farmer's account. `authorizeCredentials`
       * is already built this way so the response cannot be used to work out
       * which addresses have accounts, and adding a distinct "not an admin"
       * here would give that back for the accounts that matter most.
       */
      const refuse = () => reply.status(401).send({ error: 'That is not an administrator here.' });

      if (!parsed.success) return refuse();

      const user = await authorizeCredentials(parsed.data);
      if (user === null) return refuse();

      /**
       * The same operator test the routes make, asked here so a sign-in that
       * cannot open anything is refused at the door rather than handing over a
       * token that every subsequent request rejects.
       *
       * A second read of a user `authorizeCredentials` has already fetched.
       * That is one indexed lookup on a route limited to five attempts a
       * minute, and it buys the flag being read from one place — widening
       * `AuthorizedUser` to carry it would put an operator bit on the shape the
       * ordinary farm sign-in path uses, which is the direction this defect
       * came from in the first place.
       */
      const row = await findUserById(user.id);
      if (row === null || row.operatorSince === undefined) return refuse();

      return reply.status(200).send({
        token: await mintAccessToken(
          { userId: user.id, orgId: user.orgId, role: user.role },
          env.AUTH_SECRET,
        ),
        name: user.name,
      });
    });
  });

  app.get('/board', async (request) => {
    await requireAdmin(request, env);

    const board = await readBoard();

    /**
     * Read from the database, not from this process.
     *
     * The sweeper runs in the **API** unit; this is the **ops** unit. A module
     * variable written there was never visible here, so this panel reported "no
     * pass since boot" on every box for ever — the exact silence it exists to
     * break. `db/sweep-status.ts` has the rest of it.
     *
     * Null covers three things an operator wants told apart from the row that
     * follows it: a server whose sweeper has not had its first pass, a box
     * where the API unit is not running at all, and a database this process
     * cannot reach — the last of which `health.databaseMs` already names.
     */
    const sweep = await readSweep();

    return {
      farms: board.farms.map((farm) => ({
        orgId: farm.org._id,
        name: farm.org.name,
        createdAt: farm.org.createdAt,
        sync: farmSyncState(env, farm.org),
        people: farm.people,
        records: farm.records,
        lastWriteAt: farm.lastWriteAt,
        lastSeenAt: farm.lastSeenAt,
        builds: farm.builds,
      })),
      tokens: board.tokens,
      health: {
        ...board.health,
        sweep: {
          at: sweep?.at ?? null,
          failed: sweep?.failed ?? null,
          found: sweep?.report?.found ?? null,
          decided: sweep?.report?.decided ?? null,
          // Said out loud, because a pass that stopped short and a pass that
          // finished the job otherwise read identically on this panel.
          capped: sweep?.report?.capped ?? false,
          host: sweep?.host ?? null,
        },
      },
      trouble: board.trouble,
    };
  });

  app.post('/actions/promo', async (request, reply) => {
    await requireAdmin(request, env);
    return reply.status(200).send(await actionNewPromo(request.body));
  });

  app.post('/actions/grant', async (request, reply) => {
    await requireAdmin(request, env);
    return reply.status(200).send(await actionGrant(request.body));
  });

  return app;
}
