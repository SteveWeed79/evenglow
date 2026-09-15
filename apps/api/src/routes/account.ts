import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  ACCOUNT_DELETE_PATH,
  type DeleteAccount,
  deleteAccountSchema,
  deleteByCredentialsSchema,
  DELETION_PROOF_NEEDED,
  DELETION_REFUSED,
  type DeletionOutcome,
} from '@homefarm/contracts';
import { authorizeCredentials } from '../auth/credentials';
import { verifyGoogleIdToken } from '../auth/google';
import { verifyPassword } from '../auth/password';
import { requireMutationClaims } from '../auth/require';
import { deleteAccount, membersWhoWouldGo } from '../db/deletion';
import { findUserById, type UserDoc } from '../db/identity';
import type { Env } from '../env';
import { boardPolicy } from '../headers';
import { errorBody, HttpError } from '../http';
import { inOrgOrder } from '../org-lane';
import { accountDeletePage } from './account-page';

/**
 * Leaving: an account deleted at the request of the person it belongs to.
 *
 * Three doors to one deletion. `POST /account/delete` is the app's, on a
 * session plus a proof; the same path answers `GET` with a web page and takes
 * the page's `POST` on an email and password with no session at all, which is
 * the door Google Play requires and the one a farm with a lost phone needs.
 * `db/deletion.ts` is what all three do; this file is who may ask.
 *
 * ## The proof, and why a session is not one
 *
 * Every deletion needs the account's password or a fresh Google ID token for
 * its subject, exactly as a change of address does (`/auth/email`) and for the
 * sharper version of that reason: an address can be moved back, and a farm
 * cannot. A refresh token lifted from a device keystore must not be enough to
 * destroy two years of records.
 *
 * ## Inside the farm's lane
 *
 * `inOrgOrder`, for the reason `/members/:id` gives: counting owners and then
 * acting on the count is the check-then-act that lets two owners remove each
 * other. Two owners deleting themselves in the same second would each see the
 * other as remaining, each take only themselves, and leave a farm with no
 * owner at all — which is the state this whole design exists to prevent.
 *
 * ## Shares the sign-in limiter's shape, not its scope
 *
 * Five a minute per IP and failing closed, because a wrong password here is a
 * guess at a password. Its own registration rather than a route inside the
 * auth scope, for the reason `ops/server.ts` gives: Fastify's encapsulation
 * means a limiter registered elsewhere covers nothing here.
 */
export async function accountRoutes(app: FastifyInstance, env: Env): Promise<void> {
  /**
   * The page. Nonce per response, from the CSPRNG, for the reason the board
   * gives: a nonce an injected script could predict is no nonce.
   *
   * Outside the limited scope, deliberately. A page load is not an attempt at
   * anything, and a person who reloads it three times while reading should not
   * find the button refused on the fourth.
   */
  app.get(ACCOUNT_DELETE_PATH, async (_request, reply) => {
    const nonce = randomBytes(16).toString('base64url');
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('content-security-policy', boardPolicy(nonce))
      .send(accountDeletePage(nonce));
  });

  await app.register(async (scope) => {
    await scope.register(import('@fastify/rate-limit'), { max: 5, timeWindow: '1 minute' });

    /**
     * From inside the app: the session names the account, the body proves it.
     *
     * Two bodies on one path would be muddled, so the shape decides which door
     * this is: an `Authorization` header is the app, and its absence is the
     * page. Neither can reach the other's branch by accident — the app always
     * sends a bearer, and the page has none to send.
     */
    scope.post(ACCOUNT_DELETE_PATH, async (request, reply) => {
      try {
        if (request.headers.authorization === undefined) {
          return reply.status(200).send(await deleteByCredentials(request.body));
        }

        const claims = await requireMutationClaims(
          request.headers.authorization,
          env.AUTH_SECRET,
        );

        const parsed = deleteAccountSchema.safeParse(request.body);
        if (!parsed.success) throw new HttpError(400, DELETION_PROOF_NEEDED);

        const user = await findUserById(claims.userId);
        if (user === null) throw new HttpError(401, 'This account is no longer active.');

        if (!(await proved(user, parsed.data, env))) {
          throw new HttpError(403, DELETION_PROOF_NEEDED);
        }

        return reply.status(200).send(await runDeletion(user));
      } catch (error) {
        const { status, body } = errorBody(error);
        return reply.status(status).send(body);
      }
    });

  });

  /**
   * What a deletion would take, before it is asked for.
   *
   * The app draws the warning from this: a number of other people, or none.
   * Asked of the server rather than of the cached roster because the roster is
   * UX (invariant 8) and this sentence is the one somebody decides on.
   *
   * ## Its own limiter, and sharing one would have broken the feature
   *
   * The screen asks this **every time the panel is opened**, so on the deletion
   * route's ceiling of five a minute, somebody who opened the panel, read the
   * warning, thought better of it and came back would find the deletion itself
   * answered *"Too many attempts"* — a refusal about nothing they did, on the
   * one flow where being unable to proceed is the complaint.
   *
   * Twenty a minute rather than none, because it is still a database read on a
   * public port. It can afford the looser ceiling: it needs a valid session, it
   * answers only about the caller's own farm, and a count of one's own members
   * is not a secret from the person who can already list them. A wrong password
   * is a guess and stays at five; opening a panel is not an attempt at
   * anything.
   */
  await app.register(async (scope) => {
    await scope.register(import('@fastify/rate-limit'), { max: 20, timeWindow: '1 minute' });

    scope.get(`${ACCOUNT_DELETE_PATH}/preview`, async (request, reply) => {
      try {
        const claims = await requireMutationClaims(
          request.headers.authorization,
          env.AUTH_SECRET,
        );
        const user = await findUserById(claims.userId);
        if (user === null) throw new HttpError(401, 'This account is no longer active.');

        return reply.status(200).send({ members: await membersWhoWouldGo(user) });
      } catch (error) {
        const { status, body } = errorBody(error);
        return reply.status(status).send(body);
      }
    });
  });

  /**
   * The page's door: no session, so the sign-in pair is the whole proof.
   *
   * `authorizeCredentials` answers null for every failure — unknown address,
   * wrong password, disabled account, Google-only account — and this passes
   * that one answer through as one sentence. A page anybody can reach must not
   * become the enumerator sign-in refuses to be.
   */
  async function deleteByCredentials(body: unknown): Promise<DeletionOutcome> {
    const parsed = deleteByCredentialsSchema.safeParse(body);
    if (!parsed.success) throw new HttpError(401, DELETION_REFUSED);

    const authorized = await authorizeCredentials(parsed.data);
    if (authorized === null) throw new HttpError(401, DELETION_REFUSED);

    const user = await findUserById(authorized.id);
    if (user === null) throw new HttpError(401, DELETION_REFUSED);

    return runDeletion(user);
  }

  async function runDeletion(user: UserDoc): Promise<DeletionOutcome> {
    return inOrgOrder(user.orgId, async () => {
      // Re-read inside the lane: a removal or a role change queued ahead of
      // this request changes what the deletion takes, and the row the route
      // read before joining the queue is the one that change was made to.
      const current = await findUserById(user._id);
      if (current === null || current.disabledAt !== undefined) {
        throw new HttpError(401, 'This account is no longer active.');
      }
      return deleteAccount(current);
    });
  }
}

/**
 * Whether the body proves the account is the caller's to delete.
 *
 * The password when the account has one and the body offers one; otherwise a
 * Google ID token whose subject is the account's own. An account with both may
 * use either. A password offered against an account that has none proves
 * nothing, and is not compared against anything — the same refusal
 * `authorizeCredentials` makes, for the same reason.
 *
 * **The Google token is compared by subject, never by address.** A valid token
 * for a different Google account whose address happens to match this one's is
 * exactly the substitution `googleSub` exists to refuse.
 */
async function proved(user: UserDoc, proof: DeleteAccount, env: Env): Promise<boolean> {
  if (proof.password !== undefined && user.passwordHash !== undefined) {
    if (await verifyPassword(user.passwordHash, proof.password)) return true;
  }

  if (proof.idToken !== undefined && user.googleSub !== undefined) {
    try {
      const identity = await verifyGoogleIdToken(proof.idToken, env.googleClientIds);
      return identity.googleSub === user.googleSub;
    } catch {
      // A token that does not verify is a proof that failed, not a fault: the
      // caller is told the same sentence as for a wrong password.
      return false;
    }
  }

  return false;
}
