import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  entitlementOf,
  normalizeJoinCode,
  promoRedeemSchema,
  subscriptionFromPromo,
  syncRefusalMessage,
} from '@steading/contracts';
import { redeemPromoCode } from '../db/promo-codes';
import { requireClaims, requireMutationClaims } from '../auth/require';
import { readPlaySubscription } from '../billing/play';
import { findOrgById, findOrgIdByPurchaseToken, setSubscription } from '../db/identity';
import type { Env } from '../env';
import { errorBody, HttpError } from '../http';

/**
 * What a farm has paid for (D13).
 *
 * Three routes and they do very little, because the interesting decisions are
 * elsewhere: what a subscription buys is in `@steading/contracts/billing`, and
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

export async function billingRoutes(app: FastifyInstance, env: Env): Promise<void> {
  const config = env.playConfig;

  /**
   * What the app shows on the account screen.
   *
   * Read-path claims: this says what a farm has, and changes nothing.
   */
  app.get('/billing', async (request, reply) => {
    try {
      const claims = await requireClaims(request.headers.authorization, env.AUTH_SECRET);
      const org = await findOrgById(claims.orgId);
      const entitlement = entitlementOf(org?.subscription, Date.now());

      return reply.send({
        state: org?.subscription?.state ?? 'none',
        expiresAt: org?.subscription?.expiresAt ?? null,
        syncing: entitlement.syncing,
        // The same sentence the sync route sends, from the same function, so
        // the account screen and the chip cannot come to disagree.
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

  app.post('/billing/play', async (request, reply) => {
    try {
      const claims = await requireMutationClaims(request.headers.authorization, env.AUTH_SECRET);
      if (config === null) {
        throw new HttpError(501, 'This server is not set up to take payments.');
      }

      const parsed = purchaseSchema.safeParse(request.body);
      if (!parsed.success) throw new HttpError(400, 'That purchase could not be read.');

      const subscription = await readPlaySubscription(config, parsed.data.purchaseToken);
      // The token is stored beside the state so a later store notification —
      // which names the purchase and not the farm — can be matched back.
      await setSubscription(claims.orgId, subscription, parsed.data.purchaseToken);

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
  app.post('/billing/notifications', async (request, reply) => {
    if (config === null) return reply.status(200).send({ ok: true });

    const envelope = notificationSchema.safeParse(request.body);
    if (!envelope.success) return reply.status(200).send({ ok: true });

    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(envelope.data.message.data, 'base64').toString('utf8'));
    } catch {
      return reply.status(200).send({ ok: true });
    }

    const parsed = payloadSchema.safeParse(payload);
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
      await setSubscription(org, await readPlaySubscription(config, purchaseToken));
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
}
