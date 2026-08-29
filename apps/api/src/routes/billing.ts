import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  entitlementOf,
  normalizeJoinCode,
  promoRedeemSchema,
  subscriptionFromPromo,
  syncRefusalMessage,
} from '@homefarm/contracts';
import { redeemPromoCode } from '../db/promo-codes';
import { requireClaims, requireMutationClaims } from '../auth/require';
import { readPlaySubscription } from '../billing/play';
import { verifyPushToken } from '../billing/pubsub';
import { syncAccess } from '../billing/access';
import { findOrgById, findOrgIdByPurchaseToken, setSubscription } from '../db/identity';
import type { Env } from '../env';
import { errorBody, HttpError } from '../http';

/**
 * What a farm has paid for (D13).
 *
 * Three routes and they do very little, because the interesting decisions are
 * elsewhere: what a subscription buys is in `@homefarm/contracts/billing`, and
 * what Google's states mean is in `billing/play.ts`. This is the plumbing
 * between them.
 *
 * **The subscription state is never taken from the device.** A handset sends a
 * purchase token, which is a claim; what makes it evidence is Google
 * confirming it against the package this server was configured with. The same
 * shape as every other trust decision here — the client says what happened and
 * the server decides what is true.
 */

const purchaseSchema = z.object({ purchaseToken: z.string().min(1).max(4096) }).strict();

/**
 * Real-time developer notifications arrive base64-encoded inside a Pub/Sub
 * envelope. Only the fields this reads are described.
 */
const notificationSchema = z.object({
  message: z.object({ data: z.string().min(1).max(20_000) }),
});

const payloadSchema = z.object({
  packageName: z.string().optional(),
  subscriptionNotification: z
    .object({ purchaseToken: z.string().min(1).max(4096) })
    .optional(),
});

/**
 * The one outbound call this file makes, as a parameter.
 *
 * **A seam the route genuinely has, rather than one a test pretends it has.**
 * `sync/sweep.ts` records why that distinction matters: an ESM call site holds
 * its local binding, so a namespace spy silently fails to intercept and the
 * test passes for the wrong reason.
 *
 * It exists because the notification route is *deliberately silent* — every
 * outcome is a 200, and the state it writes comes from Google either way — so
 * "did a stranger make this server call the Play API" is not observable from
 * the outside at all. That question is the whole point of the push-token gate,
 * and a gate whose effect cannot be asserted is a gate nobody can keep.
 */
export interface BillingDeps {
  readSubscription: typeof readPlaySubscription;
}

export async function billingRoutes(
  app: FastifyInstance,
  env: Env,
  deps: BillingDeps = { readSubscription: readPlaySubscription },
): Promise<void> {
  const config = env.playConfig;
  const { readSubscription } = deps;

  /**
   * What the app shows on the account screen.
   *
   * Read-path claims: this says what a farm has, and changes nothing.
   */
  app.get('/billing', async (request, reply) => {
    try {
      const claims = await requireClaims(request.headers.authorization, env.AUTH_SECRET);
      const org = await findOrgById(claims.orgId);
      /**
       * The same DECISION the sync route makes, not merely the same function.
       *
       * This called `entitlementOf` directly and disagreed with `/sync` on
       * every server that takes no payments — telling a farm that had just
       * synced that nothing is sent anywhere. See `billing/access.ts`.
       */
      const entitlement = syncAccess(env, org);

      return reply.send({
        state: org?.subscription?.state ?? 'none',
        expiresAt: org?.subscription?.expiresAt ?? null,
        syncing: entitlement.syncing,
        message: entitlement.refusal === null ? null : syncRefusalMessage(entitlement.refusal),
      });
    } catch (error) {
      const { status, body } = errorBody(error);
      return reply.status(status).send(body);
    }
  });

  /**
   * A purchase just completed on a device.
   *
   * **The write-path guard, not the read one.** This changes what a farm is
   * entitled to, so the actor's role is re-derived from the database — and it
   * is deliberately not restricted to owners: a farm where only the owner can
   * fix a lapsed subscription is a farm that cannot sync while the owner is on
   * holiday. Any member may pay; nobody may pay for a farm they do not belong
   * to, which the token already settles.
   */
  /**
   * A promotion code, typed into the app.
   *
   * ## Rate limited like sign-in, because it is the same kind of thing
   *
   * A code is a secret somebody presents to get something, which is what a
   * password is, and the answer to guessing is the same answer: throttle hard
   * and fail closed. Redemption is also authenticated — a grant lands on *a
   * farm*, and a farm comes from a verified token — so an attacker needs an
   * account before they can spend a single guess.
   *
   * ## One sentence for every refusal, deliberately
   *
   * "That code does not work" covers unknown, spent, expired and disabled.
   * Distinguishing them would turn this into an oracle: "spent" tells a
   * guesser they found a real code, which is most of the work. The farm loses
   * nothing by the vagueness — there is exactly one thing to do about any of
   * the four, which is ask whoever gave it to you.
   *
   * ## It writes a subscription rather than a bypass
   *
   * The gate in `sync.ts` is untouched and does not know promotions exist.
   * That is the design: `entitlementOf` still decides, an expiry still
   * overrides a stored state, and `/billing` above reports a promo exactly as
   * honestly as it reports a purchase.
   */
  await app.register(async (scope) => {
    await scope.register(import('@fastify/rate-limit'), { max: 5, timeWindow: '1 minute' });

    scope.post('/billing/promo', async (request, reply) => {
      try {
        const claims = await requireMutationClaims(request.headers.authorization, env.AUTH_SECRET);

        const parsed = promoRedeemSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ error: 'That code does not work.' });
        }

        // Normalised the way a join code is: somebody reading a code off a
        // screen and typing O for 0 has not made a mistake worth refusing.
        const code = normalizeJoinCode(parsed.data.code);

        const result = await redeemPromoCode(code, claims.orgId, claims.userId);
        if (!result.ok) {
          return reply.status(404).send({ error: 'That code does not work.' });
        }

        const subscription = subscriptionFromPromo(result.grant, Date.now());
        await setSubscription(claims.orgId, subscription);

        return reply.send({
          state: subscription.state,
          expiresAt: subscription.expiresAt ?? null,
          syncing: entitlementOf(subscription, Date.now()).syncing,
          message: null,
        });
      } catch (error) {
        const { status, body } = errorBody(error);
        return reply.status(status).send(body);
      }
    });
  });

  /**
   * A purchase to verify, in its own rate-limited scope.
   *
   * **This had no limiter**, and it is the most expensive authenticated route
   * on the box: `readPlaySubscription` signs a JWT with the service-account RSA
   * key and makes two calls to Google per request. The store-notification scope
   * below got sixty a minute for exactly this reasoning, and it spends the same
   * outbound quota — the only difference is that this one needs a token first,
   * which bounds who can spend it but not how fast.
   *
   * Ten a minute per address. A device posts a purchase after buying, after a
   * reinstall, on a renewal, and on a retry when an answer was lost — a handful
   * a year each — and a farm's handsets share one address behind a house
   * router. Tighter than the notification scope because the legitimate caller
   * here is a person rather than a machine catching up after an outage.
   */
  await app.register(async (scope) => {
    await scope.register(import('@fastify/rate-limit'), { max: 10, timeWindow: '1 minute' });

    scope.post('/billing/play', async (request, reply) => {
      try {
        const claims = await requireMutationClaims(request.headers.authorization, env.AUTH_SECRET);
        if (config === null) {
          throw new HttpError(501, 'This server is not set up to take payments.');
        }

        const parsed = purchaseSchema.safeParse(request.body);
        if (!parsed.success) throw new HttpError(400, 'That purchase could not be read.');

        /**
         * One purchase, one farm.
         *
         * Google verifies the *purchase* and has no idea which farm is
         * submitting it, so a token that checks out says nothing about whose it
         * is. Without this, the same token posted by a second org wrote `active`
         * onto that org too — one subscription entitling unlimited farms, which
         * is the whole paywall.
         *
         * Checked before Google is asked: a token already spent on another farm
         * is refused whatever the store would have said about it, and there is
         * no reason to spend a round trip confirming a purchase we will not
         * honour here.
         *
         * The same-org case is deliberately allowed through. A device re-posting
         * its own token is a renewal, a reinstall, or a retry after a dropped
         * response, and every other write path in this service is idempotent for
         * exactly that reason.
         */
        const boundTo = await findOrgIdByPurchaseToken(parsed.data.purchaseToken);
        if (boundTo !== null && boundTo !== claims.orgId) {
          throw new HttpError(
            409,
            'That subscription is already on another farm. A subscription covers one farm, so this one needs its own.',
          );
        }

        const subscription = await readSubscription(config, parsed.data.purchaseToken);
        // The token is stored beside the state so a later store notification —
        // which names the purchase and not the farm — can be matched back.
        try {
          await setSubscription(claims.orgId, subscription, parsed.data.purchaseToken);
        } catch (error) {
          /**
           * Two farms posting one token in the same instant.
           *
           * The check above loses that race and the unique partial index on
           * `orgs.playPurchaseToken` is what actually settles it — so the loser
           * arrives here holding a duplicate-key error. It is the same condition
           * as the refusal above and must not reach a farm as "Something went
           * wrong", which is what an unhandled write error becomes.
           */
          if ((error as { code?: unknown } | null)?.code === 11000) {
            throw new HttpError(
              409,
              'That subscription is already on another farm. A subscription covers one farm, so this one needs its own.',
            );
          }
          throw error;
        }

        return reply.status(200).send({
          state: subscription.state,
          expiresAt: subscription.expiresAt ?? null,
          syncing: entitlementOf(subscription, Date.now()).syncing,
        });
      } catch (error) {
        const { status, body } = errorBody(error);
        return reply.status(status).send(body);
      }
    });
  });

  /**
   * The store telling us something changed — a renewal, a cancellation, a
   * recovery from a hold.
   *
   * **Unauthenticated by necessity and safe by construction.** Google's Pub/Sub
   * push carries no bearer token this server issued, so the request cannot be
   * trusted on its face. It does not need to be: the only thing taken from the
   * body is a purchase token, and the resulting state is fetched *from Google*
   * rather than read from the payload. A forged notification can therefore do
   * exactly one thing — cause this server to re-ask Google about a token — and
   * the answer is whatever was already true.
   *
   * That is why there is no shared secret here and no signature check. There
   * is nothing to protect: the request is a hint to go and look.
   *
   * **Always 200.** Pub/Sub retries anything else for days, and a notification
   * this server cannot act on is not one Google can fix by resending.
   */
  /**
   * Store notifications, in their own rate-limited scope.
   *
   * **This was unauthenticated, unthrottled, and reachable from anywhere.** The
   * state it writes was never forgeable — the handler takes a purchase token
   * out of the body and then asks *Google* what that purchase is worth, so an
   * invented payload cannot entitle a farm. What was open was the cost: every
   * request naming a real token spent an outbound Play API call and a database
   * write, with nothing bounding how many.
   *
   * Sixty a minute, which is far above anything Pub/Sub sends this box — a farm
   * changes its subscription a handful of times a year — and far below a rate
   * at which somebody else's quota is worth attacking. Deliberately looser than
   * the auth routes: this is the one scope whose legitimate caller is a machine
   * that may retry a burst after an outage.
   */
  await app.register(async (scope) => {
    await scope.register(import('@fastify/rate-limit'), { max: 60, timeWindow: '1 minute' });

    /**
     * **A 429 when the limit bites, and the first draft answered 200.**
     *
     * The reasoning for 200 was that every other answer this route gives is a
     * 200 because Pub/Sub retries anything else, so a 429 would turn a burst
     * into a longer one. Writing the test for it inverted the argument: Pub/Sub
     * retrying *is the correct response to being throttled*. A 429 costs a
     * legitimate push a delay and nothing else, because Google redelivers with
     * backoff — while a 200 tells Google the notification landed, and a real
     * subscription change caught in a burst is then lost for good.
     *
     * So the one answer here that is not a 200 is the one where something was
     * genuinely not processed. The rest are 200 because the notification was
     * read and there was nothing to do about it.
     */

    scope.post('/billing/notifications', async (request, reply) => {
      if (config === null) return reply.status(200).send({ ok: true });

      /**
       * Who is pushing, when the operator has said what to expect.
       *
       * A push subscription configured with a service account signs every
       * delivery with an OIDC token — the same shape `auth/google.ts` already
       * verifies for sign-in. An unset audience means the check is off and the
       * rate limit above is the whole control: a supported state, and the one
       * every box is in until the subscription is configured. See
       * `billing/pubsub.ts` for why that is a cost control rather than a
       * fail-open on authorization.
       *
       * A 200 for a bad token, like every other answer here. Pub/Sub retries a
       * non-200 for days, and a forged request is not one to invite back.
       */
      if (env.pubsubAudience !== null) {
        try {
          await verifyPushToken(request.headers.authorization, env.pubsubAudience);
        } catch {
          return reply.status(200).send({ ok: true });
        }
      }

      const envelope = notificationSchema.safeParse(request.body);
      if (!envelope.success) return reply.status(200).send({ ok: true });

      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.from(envelope.data.message.data, 'base64').toString('utf8'));
      } catch {
        return reply.status(200).send({ ok: true });
      }

      const parsed = payloadSchema.safeParse(payload);

      /**
       * The app the notification is about, which was parsed and then ignored.
       *
       * One service account can be subscribed to more than one application's
       * notifications, and a token from another package is not this server's to
       * reconcile — `readPlaySubscription` would ask Google about it under
       * *this* package name and get an answer about the wrong thing, or an
       * error. A notification naming no package at all is let through: older
       * ones did not carry the field, and the token lookup below refuses
       * anything this server has never seen anyway.
       */
      if (
        parsed.success &&
        parsed.data.packageName !== undefined &&
        parsed.data.packageName !== config.packageName
      ) {
        return reply.status(200).send({ ok: true });
      }

      const purchaseToken = parsed.success
        ? parsed.data.subscriptionNotification?.purchaseToken
        : undefined;

      // Test and voided-purchase notifications carry no subscription. Nothing to
      // do, and nothing wrong.
      if (purchaseToken === undefined) return reply.status(200).send({ ok: true });

      /**
       * Which farm this is about is not in the notification.
       *
       * Google names the purchase, not the customer — so the token has to be
       * matched against the farm that submitted it. A token nobody has submitted
       * belongs to a purchase this server has never seen, which is either a
       * forgery or a farm that has not finished signing up, and both are nothing
       * to act on.
       */
      const org = await findOrgIdByPurchaseToken(purchaseToken);
      if (org === null) return reply.status(200).send({ ok: true });

      try {
        await setSubscription(org, await readSubscription(config, purchaseToken));
      } catch {
        /**
         * The store was unreachable while telling us about itself.
         *
         * Swallowed on purpose: whatever is stored stands, and **an unreachable
         * store must never downgrade a paying farm.** Google resends, and the
         * expiry check in `entitlementOf` is the backstop if it never does.
         */
        return reply.status(200).send({ ok: true });
      }

      return reply.status(200).send({ ok: true });
    });
  });
}
