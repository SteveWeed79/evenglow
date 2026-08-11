import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { googleSignInSchema, isUlid, newId, signupSchema } from '@steading/contracts';
import { authorizeCredentials } from '../auth/credentials';
import { verifyGoogleIdToken } from '../auth/google';
import { hashPassword } from '../auth/password';
import { endSession, rotateSession, startSession } from '../auth/refresh';
import { verifyAccessToken } from '../auth/tokens';
import {
  deleteOrgIfEmpty,
  findOrgById,
  findUserByEmail,
  findUserByGoogleSub,
  insertOrg,
  insertUser,
  linkGoogleSub,
  normalizeEmail,
  orgHasMembers,
} from '../db/identity';
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

/**
 * The farm's name, for a response body.
 *
 * Every route that hands over a session sends this, and the client caches it
 * beside the claims. It is deliberately NOT in the access token: a name is not
 * authorization and does not belong in something re-verified on every request.
 *
 * But the client rebuilds its cached claims FROM that token, so a field the
 * cache needs and the token does not carry has to arrive alongside it every
 * time — including on refresh, which is where it was being lost. A farm that
 * renames itself sees the new name on the next rotation for the same reason.
 *
 * Absent rather than empty when the org has gone: an old session for a deleted
 * farm should say nothing, not name it.
 */
async function farmOf(orgId: string): Promise<{ org?: { name: string } }> {
  const org = await findOrgById(orgId);
  return org === null ? {} : { org: { name: org.name } };
}

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
       *
       * The farm's name travels with it, for that reason and a second one: a
       * device that SIGNS IN rather than signing up never typed the farm name
       * and had no way to learn it, so a second handset showed no farm name at
       * all. See `farmOf`.
       */
      return reply.status(200).send({
        ...pair,
        user: { id: user.id, name: user.name, role: user.role },
        ...(await farmOf(user.orgId)),
      });
    });

    /**
     * Claiming a farm that already exists on a device (A2.1, A2.2).
     *
     * The device has been running since first launch with an org ULID it
     * minted itself and a database full of records. This route is where that
     * org becomes real on the server — **adoption, not assignment**: the same
     * id, so the same database file, the same rows, the same entity ids, and
     * the queue simply begins to flush. There is no rename, no migration, and
     * no window where a device holds records under an id the server has never
     * heard of.
     *
     * See `signupSchema` for why a client-supplied orgId does not breach
     * invariant 2 and what makes a double claim structurally impossible.
     *
     * Rate limited with sign-in, and fails closed for the same reason: this is
     * the other route where an unthrottled attacker gets free attempts.
     */
    scope.post('/auth/signup', async (request, reply) => {
      const parsed = signupSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Check the details and try again.' });
      }

      const { orgId, orgName, email, password, name } = parsed.data;

      /**
       * A 26-character string is not a ULID.
       *
       * The schema checks length because that is what the wire contract says;
       * this checks the alphabet, because an id that is not a ULID is either a
       * client bug or somebody trying a chosen value, and neither should
       * become a farm.
       */
      if (!isUlid(orgId)) {
        return reply.status(400).send({ error: 'That farm id is not one this app could have made.' });
      }

      /**
       * Checked before the org is created, so the ordinary failure leaves
       * nothing behind. The race is still handled below; this only keeps the
       * common case clean.
       *
       * **This route can tell you an email is taken and there is no way round
       * it.** Somebody creating an account has to be told why it did not work,
       * and there is no email sender in this system to move the answer out of
       * band (see `MembersScreen`). `/invites/accept` made the same trade and
       * says the same sentence; sign-in, which does not need to, still says
       * one thing for every failure.
       */
      if (await findUserByEmail(email)) {
        return reply.status(409).send({
          error: 'That email already has a Steading account. Sign in with it instead.',
        });
      }

      const now = new Date();

      try {
        await insertOrg({ _id: orgId, name: orgName.trim(), createdAt: now });
      } catch (error) {
        /**
         * The insert failed, and there are three reasons it could have.
         *
         * **The id belongs to a farm with members.** Somebody's farm. Refused,
         * and this is the case `_id` uniqueness is guarding: two farms can
         * never quietly become one.
         *
         * **The id belongs to an org with no members.** A previous attempt
         * from this same device created the org and then failed to give it an
         * owner. Nobody can hold a token for a memberless org, so nothing can
         * have been written inside it — finishing the claim is safe, and
         * refusing would strand a handset full of records behind an id it
         * could never claim.
         *
         * **The database was unreachable.** The org does not exist at all, and
         * carrying on would mint a user pointing at a farm that is not there.
         * Rethrown, so it surfaces as a 500 rather than as a half-made
         * account somebody has to be talked out of later.
         */
        const existing = await findOrgById(orgId);
        if (existing === null) throw error;

        if (await orgHasMembers(orgId)) {
          return reply.status(409).send({
            error: 'That farm has already been claimed. Sign in to it instead.',
          });
        }
      }

      const userId = newId();

      try {
        await insertUser({
          _id: userId,
          email: normalizeEmail(email),
          passwordHash: await hashPassword(password),
          name,
          orgId,
          // The person who claims the farm owns it. Everyone else arrives
          // through an invite or a join code, which name their own role.
          role: 'owner',
          createdAt: now,
        });
      } catch {
        // Lost the race on the email between the check above and here. Take
        // the empty org back out rather than leaving the id spent.
        await deleteOrgIfEmpty(orgId).catch(() => undefined);
        return reply.status(409).send({
          error: 'That email already has a Steading account. Sign in with it instead.',
        });
      }

      const pair = await startSession({ userId, orgId, role: 'owner' }, env.AUTH_SECRET);

      // Signed in immediately, for the reason `/invites/accept` gives: making
      // somebody create an account and then find a sign-in screen is two
      // chances to lose them and buys nothing.
      return reply
        .status(201)
        .send({ ...pair, user: { id: userId, name, role: 'owner' }, ...(await farmOf(orgId)) });
    });

    /**
     * Google sign-in, and Google signup, on one route (A2.4).
     *
     * One route because the device cannot know which it is doing: whether an
     * address already has an account is exactly the question a sign-in screen
     * must not be able to ask. The client sends the ID token and, if it is
     * holding an unclaimed farm, the org it would claim — and the server picks.
     *
     * Three outcomes, in this order:
     *
     * 1. **Known Google account** → signed in.
     * 2. **Known email, no Google linked** → the Google identity is bound to
     *    the existing account and they are signed in. A farm that signed up
     *    with a password and later taps the Google button is the same farm,
     *    and telling them their own address is taken would be absurd.
     * 3. **Neither** → the farm on the device is claimed, exactly as
     *    `/auth/signup` does it, with Google as the credential and no password
     *    ever set. Without an `orgId` there is nothing to claim, so it refuses.
     */
    scope.post('/auth/google', async (request, reply) => {
      const parsed = googleSignInSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Check the details and try again.' });
      }

      let identity;
      try {
        identity = await verifyGoogleIdToken(parsed.data.idToken, env.googleClientIds);
      } catch (error) {
        const { status, body } = errorBody(error);
        return reply.status(status).send(body);
      }

      const now = new Date();

      // 1. The ordinary case after the first time.
      const byGoogle = await findUserByGoogleSub(identity.googleSub);
      if (byGoogle) {
        if (byGoogle.disabledAt) {
          return reply.status(401).send({ error: 'That Google sign-in did not work. Try again.' });
        }
        const pair = await startSession(
          { userId: byGoogle._id, orgId: byGoogle.orgId, role: byGoogle.role },
          env.AUTH_SECRET,
        );
        return reply
          .status(200)
          .send({
            ...pair,
            user: { id: byGoogle._id, name: byGoogle.name, role: byGoogle.role },
            ...(await farmOf(byGoogle.orgId)),
          });
      }

      // 2. Same person, arriving a different way. Safe because the token
      //    carries `email_verified: true` — see `verifyGoogleIdToken`.
      const byEmail = await findUserByEmail(identity.email);
      if (byEmail) {
        if (byEmail.disabledAt) {
          return reply.status(401).send({ error: 'That Google sign-in did not work. Try again.' });
        }
        await linkGoogleSub(byEmail._id, identity.googleSub);
        const pair = await startSession(
          { userId: byEmail._id, orgId: byEmail.orgId, role: byEmail.role },
          env.AUTH_SECRET,
        );
        return reply
          .status(200)
          .send({
            ...pair,
            user: { id: byEmail._id, name: byEmail.name, role: byEmail.role },
            ...(await farmOf(byEmail.orgId)),
          });
      }

      // 3. A farm claiming itself, with Google instead of a password.
      const { orgId, orgName } = parsed.data;
      if (orgId === undefined || orgName === undefined) {
        return reply.status(404).send({
          error: 'No Steading account uses that Google address yet.',
        });
      }

      if (!isUlid(orgId)) {
        return reply.status(400).send({ error: 'That farm id is not one this app could have made.' });
      }

      try {
        await insertOrg({ _id: orgId, name: orgName.trim(), createdAt: now });
      } catch (error) {
        // The same three-way reading as `/auth/signup`; see the note there.
        const existing = await findOrgById(orgId);
        if (existing === null) throw error;

        if (await orgHasMembers(orgId)) {
          return reply.status(409).send({
            error: 'That farm has already been claimed. Sign in to it instead.',
          });
        }
      }

      const userId = newId();

      try {
        await insertUser({
          _id: userId,
          email: normalizeEmail(identity.email),
          googleSub: identity.googleSub,
          // No passwordHash, deliberately. Nothing was set, so nothing can be
          // guessed — see `authorizeCredentials`, which refuses the account
          // rather than comparing against an absent digest.
          name: identity.name ?? parsed.data.name ?? identity.email.split('@')[0] ?? 'Farmer',
          orgId,
          role: 'owner',
          createdAt: now,
        });
      } catch (error) {
        await deleteOrgIfEmpty(orgId).catch(() => undefined);
        throw error;
      }

      const pair = await startSession({ userId, orgId, role: 'owner' }, env.AUTH_SECRET);
      return reply
        .status(201)
        .send({
          ...pair,
          user: { id: userId, name: identity.name ?? 'Farmer', role: 'owner' },
          ...(await farmOf(orgId)),
        });
    });

    scope.post('/auth/refresh', async (request, reply) => {
      const parsed = refreshSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(401).send({ error: 'Your session has expired. Sign in again.' });
      }

      try {
        const pair = await rotateSession(parsed.data.refreshToken, env.AUTH_SECRET);

        /**
         * Repeated on every refresh, and it has to be.
         *
         * The client rebuilds its cached claims from the access token, which
         * carries `sub`, `orgId` and `role` and nothing else — so anything the
         * cache holds beyond those three has to be either re-sent or carried
         * forward, and a farm that renames itself should see the new name
         * rather than the one this device happened to be told at signup.
         *
         * `rotateSession` has already re-derived the user from the database
         * for exactly this kind of reason: a long-lived session is the one
         * place stale facts accumulate.
         */
        const claims = await verifyAccessToken(pair.accessToken, env.AUTH_SECRET);

        return reply.status(200).send({ ...pair, ...(await farmOf(claims.orgId)) });
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
