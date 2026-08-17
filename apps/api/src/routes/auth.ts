import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  FORGOT_ACKNOWLEDGEMENT,
  forgotSchema,
  googleSignInSchema,
  isUlid,
  newId,
  NO_MAIL_CONFIGURED,
  normalizeResetCode,
  RESET_CODE_TTL_MINUTES,
  RESET_REFUSAL,
  resetSchema,
  signupSchema,
} from '@steading/contracts';
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
  setPasswordHash,
} from '../db/identity';
import {
  claimResetCode,
  hashResetCode,
  mintResetCode,
  replaceResetCode,
  resetsSince,
} from '../db/password-resets';
import { revokeAllForUser } from '../db/refresh-tokens';
import { canSendMail, mailerFor, trySend } from '../mail/send';
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

  await recoveryRoutes(app, env);
}

/**
 * How long `/auth/forgot` takes, whatever it did.
 *
 * **The assertion implementations skip.** A real account does an argon2 hash,
 * a database write and an HTTP call to a mail provider; an unknown address
 * returns immediately, and the difference is measurable from outside — which
 * turns a route built not to enumerate accounts into one that enumerates them
 * by stopwatch.
 *
 * Held to a floor rather than doing fake work: simpler, and it does not spend
 * the box's CPU on an attacker's behalf. Long enough to cover a slow provider
 * call on a small instance, short enough that a person waiting on it does not
 * think the button failed.
 */
const FORGOT_FLOOR_MS = 900;

/**
 * How many codes one account may be sent in an hour.
 *
 * **The anti-harassment limit, and the one that is easy to forget.** The
 * per-IP limiter on this scope stops somebody hammering the route; it does
 * nothing to stop them filling one farmer's inbox from a phone, a laptop and a
 * VPN. Three is enough for somebody who genuinely mistyped their address twice.
 */
const CODES_PER_ACCOUNT_PER_HOUR = 3;

async function notBefore<T>(floorMs: number, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } finally {
    const remaining = floorMs - (Date.now() - started);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

/**
 * Getting back in — `docs/PASSWORD-RECOVERY.md`.
 *
 * A code the person types, not a link they click. The security argument is
 * phishing: an email that trains people to click a reset link trains them to
 * click *any* link claiming to be one, and a code carried into an app they
 * already have open cannot be redirected to a lookalike domain. The practical
 * argument is that email is read on a phone and the farm's records are on the
 * tablet in the kitchen — a link completes on the device that opened it, and a
 * code travels.
 */
async function recoveryRoutes(app: FastifyInstance, env: Env): Promise<void> {
  await app.register(async (scope) => {
    /**
     * Its own registration, and tighter than sign-in.
     *
     * Three a minute per IP: this route sends mail, so an unthrottled one is
     * both an enumeration oracle and somebody else's mail bill. It fails closed
     * like every limiter on this file.
     */
    await scope.register(import('@fastify/rate-limit'), { max: 3, timeWindow: '1 minute' });

    scope.post('/auth/forgot', async (request, reply) => {
      /**
       * A server with no mail says so, and this is the one refusal here that is
       * allowed to be distinct.
       *
       * It describes the *server*, not the account — it is the same answer for
       * every address, including ones that do not exist — so it discloses
       * nothing §5 protects. Refused at the edge rather than at send time,
       * because the alternative is a farmer waiting for mail from a box that
       * was never going to send any.
       */
      if (!canSendMail(env)) {
        return reply.status(503).send({ error: NO_MAIL_CONFIGURED });
      }

      await notBefore(FORGOT_FLOOR_MS, async () => {
        const parsed = forgotSchema.safeParse(request.body);
        if (!parsed.success) return;

        const user = await findUserByEmail(parsed.data.email);
        // Unknown address, or an account somebody has removed. Nothing is done
        // and the answer below is identical.
        if (!user || user.disabledAt) return;

        /**
         * Per account, on top of the per-IP limit above, because they stop
         * different attacks: the IP limit stops a flood, and this stops one
         * farmer's inbox being filled by somebody who knows their address.
         */
        const hour = new Date(Date.now() - 3_600_000);
        if ((await resetsSince(user._id, hour)) >= CODES_PER_ACCOUNT_PER_HOUR) return;

        const code = mintResetCode();
        const now = new Date();

        /**
         * Stored before the send is attempted, so a provider outage leaves a
         * farmer who waits and asks again rather than a broken row.
         */
        await replaceResetCode({
          _id: hashResetCode(normalizeResetCode(code)),
          userId: user._id,
          createdAt: now,
          expiresAt: new Date(now.getTime() + RESET_CODE_TTL_MINUTES * 60_000),
          attempts: 0,
        });

        // The result is deliberately dropped. Surfacing a send failure
        // differently from a success would reintroduce the enumeration this
        // whole route is shaped around; `trySend` puts the reason in the
        // journal, where the person who can fix it will see it.
        await trySend(mailerFor(env), {
          to: user.email,
          subject: 'Your Steading reset code',
          text: resetEmailText(code, user.name),
        });
      });

      /**
       * 202, always. Same body, same shape, whether or not that address
       * belongs to anybody — and now the same duration too.
       */
      return reply.status(202).send({ ok: true, message: FORGOT_ACKNOWLEDGEMENT });
    });

    scope.post('/auth/reset', async (request, reply) => {
      const parsed = resetSchema.safeParse(request.body);
      // One refusal for every failure, starting with a malformed body: a
      // password below the bar and a wrong code must not be told apart, or the
      // route says which half was right.
      if (!parsed.success) return reply.status(400).send({ error: RESET_REFUSAL });

      const user = await findUserByEmail(parsed.data.email);
      if (!user || user.disabledAt) return reply.status(400).send({ error: RESET_REFUSAL });

      const now = new Date();
      const claim = await claimResetCode(
        hashResetCode(normalizeResetCode(parsed.data.code)),
        user._id,
        now,
      );
      if (!claim.ok) return reply.status(400).send({ error: RESET_REFUSAL });

      /**
       * Three writes, and the order is the load-bearing part.
       *
       * Sessions die first. A crash after this point signs everybody out of an
       * account whose password did not change, which is survivable — the owner
       * signs in again with the old one. A crash the other way round leaves a
       * live session belonging to whoever prompted the reset, on an account
       * whose password has just been changed, which is the exact outcome the
       * reset exists to prevent.
       *
       * The code is already marked used by `claimResetCode`, which had to do it
       * atomically to be single-use at all — so the third write of the design's
       * three has already happened by the time this runs.
       */
      const killed = await revokeAllForUser(user._id, now);
      await setPasswordHash(user.email, await hashPassword(parsed.data.password));

      console.log(`auth: password reset completed, ${killed} session(s) revoked`);

      /**
       * 204 and no session. Signing them in here would hand a session to
       * whoever submitted the form, and the next thing they do is sign in with
       * the password they just chose — which proves they know it.
       */
      return reply.status(204).send();
    });
  });
}

/**
 * What the email says.
 *
 * Short, plain, and it names the app first — `PASSWORD-RECOVERY.md` §8.2 warns
 * that a reset from a domain the farm has never heard of is indistinguishable
 * from phishing, and until the sending domain says Steading the body is what
 * has to carry that. It also says what to do if it was not them, because a
 * reset code nobody asked for is the only warning an account gets.
 *
 * No link, deliberately — see §3. There is nothing in here to click.
 */
function resetEmailText(code: string, name: string): string {
  return [
    `Hello ${name},`,
    '',
    'Someone asked to reset the password on your Steading account.',
    'Type this code into the app:',
    '',
    `    ${code}`,
    '',
    `It is good for ${RESET_CODE_TTL_MINUTES} minutes and can be used once.`,
    '',
    'If that was not you, nothing has changed and you do not need to do',
    'anything. Your records are on your phone either way.',
  ].join('\n');
}
