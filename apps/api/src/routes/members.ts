import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  inviteAcceptSchema,
  inviteCreateSchema,
  INVITE_TTL_DAYS,
  joinCodeCreateSchema,
  joinCodeRedeemSchema,
  JOIN_CODE_TTL_MINUTES,
  newId,
  normalizeJoinCode,
  refusalMessage,
  canRenameFarm,
  renameFarmSchema,
  refuseRemoval,
  refuseRoleChange,
  roleSchema,
  canAssign,
  canInvite,
  type PendingInvite,
} from '@steading/contracts';
import { requireClaims, requireMutationClaims } from '../auth/require';
import { hashPassword } from '../auth/password';
import { startSession } from '../auth/refresh';
import {
  countOwners,
  disableUser,
  findOrgById,
  findUserByEmail,
  findUserById,
  insertUser,
  listMembers,
  normalizeEmail,
  setUserRole,
  renameOrg,
} from '../db/identity';
import {
  acceptInvite,
  emailMatches,
  findInviteByToken,
  hashInviteToken,
  insertInvite,
  listPendingInvites,
  mintInviteToken,
  revokeInvite,
} from '../db/invites';
import {
  findJoinCode,
  hashJoinCode,
  liveJoinCodeExpiry,
  mintJoinCode,
  redeemJoinCode,
  replaceJoinCode,
} from '../db/join-codes';
import type { Env } from '../env';
import { errorBody, HttpError } from '../http';

/**
 * Getting a second person onto a farm.
 *
 * D7 built the role matrix and never built this, so until now the only way to
 * let a farmhand log the morning's eggs was to hand over the owner's password.
 *
 * Every policy decision here is in `@steading/contracts/membership` and is
 * re-evaluated on the request that acts, against the database rather than
 * against the token (invariant 8). The client has the same functions and uses
 * them only to decide what to draw.
 */

const DAY_MS = 86_400_000;

/** The role change and removal bodies. Both name the target in the path. */
const roleChangeSchema = z.object({ role: roleSchema }).strict();

export async function memberRoutes(app: FastifyInstance, env: Env): Promise<void> {
  /**
   * The accept path is rate limited and the rest is not, and the asymmetry is
   * the point: accepting is the only route here reachable without a session,
   * so it is the only one an attacker can reach at all.
   *
   * Fails closed, like sign-in. A throttled acceptance costs someone a minute;
   * an unthrottled one is an oracle for guessing tokens.
   */
  await app.register(async (scope) => {
    await scope.register(import('@fastify/rate-limit'), { max: 10, timeWindow: '1 minute' });

    /**
     * What the person holding the link is shown before they commit.
     *
     * Reveals the farm's name, the role offered and the address it was sent
     * to — all of which the bearer of the secret is entitled to. It reveals
     * nothing about whether that address already has an account, because that
     * would turn a leaked link into an account oracle.
     */
    scope.get<{ Params: { token: string } }>('/invites/:token', async (request, reply) => {
      const invite = await findInviteByToken(request.params.token);

      // One answer for missing, revoked, used and expired. Distinguishing them
      // tells a guesser which tokens exist.
      if (
        !invite ||
        invite.acceptedAt ||
        invite.revokedAt ||
        invite.expiresAt.getTime() <= Date.now()
      ) {
        return reply.status(404).send({ error: 'That invitation is no longer valid.' });
      }

      // The farm's name, not the inviter's. "Sam invited you" is not what
      // someone needs to decide whether this is the right link — "Hollow Farm"
      // is, and it is the thing they will recognise.
      const org = await findOrgById(invite.orgId);

      return reply.send({
        orgName: org?.name ?? 'a farm',
        invitedBy: invite.invitedByName,
        role: invite.role,
        email: invite.email,
        expiresAt: invite.expiresAt.getTime(),
      });
    });

    scope.post('/invites/accept', async (request, reply) => {
      const parsed = inviteAcceptSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Check the details and try again.' });
      }

      const { token, email, password, name } = parsed.data;
      const invite = await findInviteByToken(token);
      const invalid = { error: 'That invitation is no longer valid.' };

      if (!invite || invite.acceptedAt || invite.revokedAt) {
        return reply.status(404).send(invalid);
      }
      if (invite.expiresAt.getTime() <= Date.now()) return reply.status(404).send(invalid);

      /**
       * The token proves someone has the link; the email proves they are who
       * it was for. Constant-time, so a leaked link cannot be used to recover
       * the invited address a character at a time.
       */
      if (!emailMatches(invite.email, email)) {
        return reply.status(404).send(invalid);
      }

      /**
       * An existing account cannot accept an invite.
       *
       * A user belongs to exactly one org, so accepting would MOVE them — and
       * every record they wrote on the old farm would be stranded behind a
       * tenancy boundary their account no longer sits inside. Refused rather
       * than silently destructive. Joining a second farm needs a membership
       * model this schema does not have, and inventing one here to make an
       * error message go away would be the wrong place to decide it.
       */
      if (await findUserByEmail(email)) {
        return reply.status(409).send({
          error: 'That email already has a Steading account. Sign in with it instead.',
        });
      }

      const userId = newId();
      const accepted = await acceptInvite(hashInviteToken(token), userId, new Date());
      // Lost the race with another acceptance of the same link. The filter is
      // the guard, so exactly one of the two gets here.
      if (!accepted) return reply.status(404).send(invalid);

      await insertUser({
        _id: userId,
        email: normalizeEmail(email),
        passwordHash: await hashPassword(password),
        name: invite.name ?? name,
        orgId: invite.orgId,
        role: invite.role,
        createdAt: new Date(),
      });

      // Signed in immediately. Making someone accept an invite and then find a
      // sign-in screen is two chances to lose them for no security gained.
      const tokens = await startSession({ userId, orgId: invite.orgId, role: invite.role }, env.AUTH_SECRET);

      return reply.status(201).send({ ...tokens, user: { id: userId, name, role: invite.role } });
    });

    /**
     * Redeeming a six-character code (A2.5).
     *
     * Inside the same rate-limited scope as `/invites/accept`, and that is not
     * incidental: a short code is only safe because the number of attempts is
     * bounded, so this route existing outside the throttle would undo the
     * whole argument in `db/join-codes.ts`.
     *
     * The shape mirrors accepting an invite — one answer for every failure, an
     * existing account refused for the same reason, signed in on success —
     * with one difference: there is no email to check the redeemer against,
     * because a code has no addressee. The code *is* the credential, and the
     * owner handed it over in person.
     */
    scope.post('/join-codes/redeem', async (request, reply) => {
      const parsed = joinCodeRedeemSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Check the details and try again.' });
      }

      const { code, email, password, name } = parsed.data;
      const invalid = { error: 'That code is not valid. Ask for a fresh one.' };

      const normalised = normalizeJoinCode(code);
      const joinCode = await findJoinCode(hashJoinCode(normalised));

      // One answer for missing, spent and expired. Distinguishing them tells a
      // guesser which codes exist, which is most of what a guesser wants.
      const now = new Date();
      if (!joinCode || joinCode.redeemedAt || joinCode.expiresAt <= now) {
        return reply.status(404).send(invalid);
      }

      /**
       * An existing account cannot join a farm, for the reason
       * `/invites/accept` gives at length: a user belongs to exactly one org,
       * so joining would MOVE them and strand every record they wrote behind a
       * tenancy boundary their account no longer sits inside.
       */
      if (await findUserByEmail(email)) {
        return reply.status(409).send({
          error: 'That email already has a Steading account. Sign in with it instead.',
        });
      }

      const userId = newId();

      // Spent before the user is created, so a crash cannot leave a code that
      // still works. The filter is the guard: exactly one of two simultaneous
      // redemptions gets past this line.
      if (!(await redeemJoinCode(joinCode._id, userId, now))) {
        return reply.status(404).send(invalid);
      }

      await insertUser({
        _id: userId,
        email: normalizeEmail(email),
        passwordHash: await hashPassword(password),
        name,
        orgId: joinCode.orgId,
        role: joinCode.role,
        createdAt: now,
      });

      const tokens = await startSession(
        { userId, orgId: joinCode.orgId, role: joinCode.role },
        env.AUTH_SECRET,
      );

      return reply.status(201).send({ ...tokens, user: { id: userId, name, role: joinCode.role } });
    });
  });

  // ── the farm side, all authenticated ──────────────────────────────────────

  app.get('/members', async (request, reply) => {
    try {
      const claims = await requireClaims(request.headers.authorization, env.AUTH_SECRET);
      const members = await listMembers(claims.orgId);

      return reply.send({
        members: members.map((m) => ({
          id: m._id,
          name: m.name,
          // Removal moves the address to `formerEmail` and leaves a
          // `removed:<id>` token in its place, so that the person can make an
          // account again — see `disableUser`. The farm should still see who it
          // was, so the list asks for the one that is a real address.
          email: m.formerEmail ?? m.email,
          role: m.role,
          disabled: m.disabledAt !== undefined,
        })),
      });
    } catch (error) {
      const { status, body } = errorBody(error);
      return reply.status(status).send(body);
    }
  });

  app.get('/invites', async (request, reply) => {
    try {
      const claims = await requireMutationClaims(request.headers.authorization, env.AUTH_SECRET);
      if (!canInvite(claims.role)) throw new HttpError(403, refusalMessage('not-permitted'));

      const pending = await listPendingInvites(claims.orgId);
      const invites: PendingInvite[] = pending.map((i) => ({
        id: i.publicId,
        email: i.email,
        role: i.role,
        invitedBy: i.invitedByName,
        createdAt: i.createdAt.getTime(),
        expiresAt: i.expiresAt.getTime(),
      }));

      return reply.send({ invites });
    } catch (error) {
      const { status, body } = errorBody(error);
      return reply.status(status).send(body);
    }
  });

  /**
   * Minting the code the owner holds out (A2.5).
   *
   * The same authority as sending an invite, and re-derived from the database
   * rather than the token, because it grants access to a farm. An admin still
   * cannot mint an owner.
   *
   * **The code comes back once, in this response, and is never readable
   * again** — only its hash is stored. An owner who loses the screen presses
   * the button again, which replaces the old one rather than adding to it.
   */
  /**
   * Renaming the farm.
   *
   * A farm name is typed once during signup by somebody doing four other things
   * at the same time, and then shown on every screen forever. There was no way
   * to change it — *"what happens if they get a partner, divorced, drunk when
   * they start the farm in the app and misspell it?"*
   *
   * `PATCH`, because this changes one field of a thing that already exists. The
   * org is found from the verified token and never from the payload (invariant
   * 2), so there is no request shape that renames somebody else's farm.
   *
   * Every device picks it up at its next refresh: `refreshSession` re-reads the
   * org's name and rewrites the cached claims, which is what makes the name on
   * a second handset correct itself without anybody signing out.
   */
  app.patch('/org', async (request, reply) => {
    try {
      const claims = await requireMutationClaims(request.headers.authorization, env.AUTH_SECRET);
      if (!canRenameFarm(claims.role)) throw new HttpError(403, refusalMessage('not-permitted'));

      const parsed = renameFarmSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message ?? 'A farm needs a name.');
      }

      const renamed = await renameOrg(claims.orgId, parsed.data.name);
      if (!renamed) throw new HttpError(404, 'That farm is no longer here.');

      return reply.send({ name: parsed.data.name });
    } catch (error) {
      const { status, body } = errorBody(error);
      return reply.status(status).send(body);
    }
  });

  app.post('/join-codes', async (request, reply) => {
    try {
      const claims = await requireMutationClaims(request.headers.authorization, env.AUTH_SECRET);
      if (!canInvite(claims.role)) throw new HttpError(403, refusalMessage('not-permitted'));

      const parsed = joinCodeCreateSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new HttpError(400, 'Check the role.');

      if (!canAssign(claims.role, parsed.data.role)) {
        throw new HttpError(403, refusalMessage('cannot-assign-that-role'));
      }

      const code = mintJoinCode();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + JOIN_CODE_TTL_MINUTES * 60_000);

      await replaceJoinCode({
        _id: hashJoinCode(code),
        orgId: claims.orgId,
        role: parsed.data.role,
        createdByUserId: claims.userId,
        createdAt: now,
        expiresAt,
      });

      return reply.status(201).send({ code, role: parsed.data.role, expiresAt: expiresAt.getTime() });
    } catch (error) {
      const { status, body } = errorBody(error);
      return reply.status(status).send(body);
    }
  });

  /**
   * Whether a code is currently live, for a screen returning to itself.
   *
   * The expiry only — the code is not recoverable, by design. A farm that
   * comes back to this screen sees "a code is live for another four minutes"
   * and can replace it; it cannot be shown the characters again.
   */
  app.get('/join-codes', async (request, reply) => {
    try {
      const claims = await requireClaims(request.headers.authorization, env.AUTH_SECRET);
      const expiresAt = await liveJoinCodeExpiry(claims.orgId, new Date());
      return reply.send({ expiresAt: expiresAt?.getTime() ?? null });
    } catch (error) {
      const { status, body } = errorBody(error);
      return reply.status(status).send(body);
    }
  });

  app.post('/invites', async (request, reply) => {
    try {
      // The write-path guard, not the read-path one: this grants access to a
      // farm, so the actor's role is re-derived from the database.
      const claims = await requireMutationClaims(request.headers.authorization, env.AUTH_SECRET);
      if (!canInvite(claims.role)) throw new HttpError(403, refusalMessage('not-permitted'));

      const parsed = inviteCreateSchema.safeParse(request.body);
      if (!parsed.success) throw new HttpError(400, 'Check the email and role.');

      // An admin cannot mint an owner. See assignableRoles — without this an
      // admin could invite themselves back as one.
      if (!canAssign(claims.role, parsed.data.role)) {
        throw new HttpError(403, refusalMessage('cannot-assign-that-role'));
      }

      const actor = await findUserById(claims.userId);
      if (!actor) throw new HttpError(401, 'This account is no longer active.');

      const token = mintInviteToken();
      const now = new Date();

      await insertInvite({
        _id: hashInviteToken(token),
        publicId: newId(),
        orgId: claims.orgId,
        email: parsed.data.email,
        role: parsed.data.role,
        ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
        invitedByUserId: actor._id,
        invitedByName: actor.name,
        createdAt: now,
        expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS),
      });

      /**
       * The token is returned ONCE, here, and never again.
       *
       * There is no email sender in this system, so the farm passes the link on
       * themselves. Storing it retrievably would mean a database disclosure
       * handed over live invites, which is the entire reason it is hashed.
       */
      return reply.status(201).send({ token, expiresAt: now.getTime() + INVITE_TTL_DAYS * DAY_MS });
    } catch (error) {
      const { status, body } = errorBody(error);
      return reply.status(status).send(body);
    }
  });

  app.delete<{ Params: { id: string } }>('/invites/:id', async (request, reply) => {
    try {
      const claims = await requireMutationClaims(request.headers.authorization, env.AUTH_SECRET);
      if (!canInvite(claims.role)) throw new HttpError(403, refusalMessage('not-permitted'));

      const revoked = await revokeInvite(claims.orgId, request.params.id, new Date());
      // 404 rather than 403 for an invite belonging to another farm: the
      // isolation rule is no existence disclosure, and that applies here too.
      if (!revoked) throw new HttpError(404, 'That invitation is no longer valid.');

      return reply.status(204).send();
    } catch (error) {
      const { status, body } = errorBody(error);
      return reply.status(status).send(body);
    }
  });

  app.patch<{ Params: { id: string } }>('/members/:id/role', async (request, reply) => {
    try {
      const claims = await requireMutationClaims(request.headers.authorization, env.AUTH_SECRET);

      const parsed = roleChangeSchema.safeParse(request.body);
      if (!parsed.success) throw new HttpError(400, 'That is not a role.');

      const target = await findUserById(request.params.id);
      // Scoped before anything else is decided: a target in another farm is
      // indistinguishable from one that does not exist.
      if (!target || target.orgId !== claims.orgId) {
        throw new HttpError(404, 'No such member.');
      }

      const refusal = refuseRoleChange(
        {
          actorId: claims.userId,
          actorRole: claims.role,
          targetId: target._id,
          targetRole: target.role,
          ownerCount: await countOwners(claims.orgId),
        },
        parsed.data.role,
      );
      if (refusal) throw new HttpError(403, refusalMessage(refusal));

      await setUserRole(claims.orgId, target._id, parsed.data.role);
      return reply.send({ id: target._id, role: parsed.data.role });
    } catch (error) {
      const { status, body } = errorBody(error);
      return reply.status(status).send(body);
    }
  });

  app.delete<{ Params: { id: string } }>('/members/:id', async (request, reply) => {
    try {
      const claims = await requireMutationClaims(request.headers.authorization, env.AUTH_SECRET);

      const target = await findUserById(request.params.id);
      if (!target || target.orgId !== claims.orgId) throw new HttpError(404, 'No such member.');

      const refusal = refuseRemoval({
        actorId: claims.userId,
        actorRole: claims.role,
        targetId: target._id,
        targetRole: target.role,
        ownerCount: await countOwners(claims.orgId),
      });
      if (refusal) throw new HttpError(403, refusalMessage(refusal));

      await disableUser(claims.orgId, target._id, new Date());
      return reply.status(204).send();
    } catch (error) {
      const { status, body } = errorBody(error);
      return reply.status(status).send(body);
    }
  });
}
