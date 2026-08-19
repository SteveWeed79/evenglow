import { describe, expect, it } from 'vitest';
import {
  assignableRoles,
  canAssign,
  canInvite,
  inviteAcceptSchema,
  inviteCreateSchema,
  joinCodeRedeemSchema,
  JOIN_CODE_LENGTH,
  JOIN_CODE_TTL_MINUTES,
  normalizeJoinCode,
  signupSchema,
  refusalMessage,
  refuseRemoval,
  refuseRoleChange,
  ROLES,
  type MembershipChange,
  type Role,
} from '@homefarm/contracts';

/**
 * Who may add, promote and remove whom.
 *
 * This is an authorization matrix, so the tests are written the way an
 * authorization matrix should be: every role against every role, exhaustively,
 * rather than a handful of cases someone thought of. The two failures that
 * matter are opposites and both are permanent —
 *
 * - **escalation**, where someone ends up with power they were not given, and
 * - **lockout**, where a farm ends up with nobody who can grant it.
 */

const change = (over: Partial<MembershipChange> = {}): MembershipChange => ({
  actorId: 'actor',
  actorRole: 'owner',
  targetId: 'target',
  targetRole: 'hand',
  ownerCount: 2,
  ...over,
});

describe('who may invite', () => {
  it('is owners and admins, never hands', () => {
    expect(canInvite('owner')).toBe(true);
    expect(canInvite('admin')).toBe(true);
    expect(canInvite('hand')).toBe(false);
  });
});

describe('what may be granted', () => {
  /**
   * The escalation case, and the reason the matrix exists at all: an admin who
   * could invite an owner could invite themselves back as one, and the
   * distinction between the two roles would mean nothing.
   */
  it('never lets an admin mint an owner', () => {
    expect(assignableRoles('admin')).toEqual(['admin', 'hand']);
    expect(canAssign('admin', 'owner')).toBe(false);
  });

  it('lets an owner grant anything, including another owner', () => {
    expect(assignableRoles('owner')).toEqual([...ROLES]);
  });

  /** Lateral is fine: an admin inviting an admin adds no power they lacked. */
  it('allows a lateral grant', () => {
    expect(canAssign('admin', 'admin')).toBe(true);
  });

  it('gives a hand nothing to grant', () => {
    expect(assignableRoles('hand')).toEqual([]);
    for (const role of ROLES) expect(canAssign('hand', role)).toBe(false);
  });

  /** Exhaustive, so a role added later cannot slip through unconsidered. */
  it.each(ROLES)('%s can never grant above itself', (actor: Role) => {
    if (actor !== 'owner') expect(canAssign(actor, 'owner')).toBe(false);
  });
});

describe('changing a role', () => {
  it('refuses a hand outright', () => {
    expect(refuseRoleChange(change({ actorRole: 'hand' }), 'admin')).toBe('not-permitted');
  });

  /**
   * Nobody changes their own role. It stops an admin promoting themselves, and
   * it stops an owner demoting themselves out of the only role that can undo it.
   */
  it('refuses acting on yourself', () => {
    expect(refuseRoleChange(change({ targetId: 'actor' }), 'owner')).toBe('self');
    expect(refuseRoleChange(change({ actorRole: 'admin', targetId: 'actor' }), 'owner')).toBe('self');
  });

  /**
   * The lockout case. A farm with no owner has nobody who can invite one, and
   * the recovery path is a support request to a project with no support.
   */
  it('refuses demoting the last owner', () => {
    expect(refuseRoleChange(change({ targetRole: 'owner', ownerCount: 1 }), 'admin')).toBe('last-owner');
    expect(refuseRoleChange(change({ targetRole: 'owner', ownerCount: 1 }), 'hand')).toBe('last-owner');
  });

  it('allows demoting an owner once there is a second', () => {
    expect(refuseRoleChange(change({ targetRole: 'owner', ownerCount: 2 }), 'admin')).toBeNull();
  });

  /** Promoting an owner to owner is a no-op, and never a lockout. */
  it('never calls a promotion a lockout', () => {
    expect(refuseRoleChange(change({ targetRole: 'owner', ownerCount: 1 }), 'owner')).toBeNull();
    expect(refuseRoleChange(change({ targetRole: 'hand', ownerCount: 1 }), 'owner')).toBeNull();
  });

  /** An admin cannot act on an owner in either direction. */
  it('keeps an admin away from an owner entirely', () => {
    expect(refuseRoleChange(change({ actorRole: 'admin', targetRole: 'owner' }), 'admin')).toBe(
      'not-permitted',
    );
  });

  it('lets an owner do the ordinary thing', () => {
    expect(refuseRoleChange(change({ targetRole: 'hand' }), 'admin')).toBeNull();
    expect(refuseRoleChange(change({ actorRole: 'admin', targetRole: 'hand' }), 'admin')).toBeNull();
  });
});

describe('removing a member', () => {
  it('refuses a hand, yourself, and the last owner', () => {
    expect(refuseRemoval(change({ actorRole: 'hand' }))).toBe('not-permitted');
    expect(refuseRemoval(change({ targetId: 'actor' }))).toBe('self');
    expect(refuseRemoval(change({ targetRole: 'owner', ownerCount: 1 }))).toBe('last-owner');
  });

  it('keeps an admin away from an owner', () => {
    expect(refuseRemoval(change({ actorRole: 'admin', targetRole: 'owner', ownerCount: 3 }))).toBe(
      'not-permitted',
    );
  });

  it('lets an owner remove anyone else', () => {
    expect(refuseRemoval(change({ targetRole: 'admin' }))).toBeNull();
    expect(refuseRemoval(change({ targetRole: 'owner', ownerCount: 2 }))).toBeNull();
  });
});

describe('refusals are named', () => {
  /** Never a bare 403. Someone standing in a barn needs to know what to do. */
  it('says what to do about the one that has a next step', () => {
    expect(refusalMessage('last-owner')).toContain('Make someone else an owner first');
  });

  it('has a sentence for every refusal', () => {
    for (const r of ['not-permitted', 'cannot-assign-that-role', 'last-owner', 'self'] as const) {
      expect(refusalMessage(r).length).toBeGreaterThan(10);
    }
  });
});

describe('invite shapes', () => {
  /**
   * The email is required, and the invite is bound to it. A bearer link is
   * simpler and travels by text message and sits in a phone forever; binding
   * makes a leaked link useless to anyone but the person it was for.
   */
  it('will not create an invite without an address to bind to', () => {
    expect(inviteCreateSchema.safeParse({ role: 'hand' }).success).toBe(false);
    expect(inviteCreateSchema.safeParse({ email: 'not-an-email', role: 'hand' }).success).toBe(false);
    expect(inviteCreateSchema.safeParse({ email: 'sam@example.com', role: 'hand' }).success).toBe(true);
  });

  it('refuses a role that is not a role, and fields that are not in the shape', () => {
    expect(inviteCreateSchema.safeParse({ email: 'a@b.co', role: 'superuser' }).success).toBe(false);
    expect(
      inviteCreateSchema.safeParse({ email: 'a@b.co', role: 'hand', orgId: 'X'.repeat(26) }).success,
    ).toBe(false);
  });

  /** The same 12-character floor sign-up uses. An invite is not a side door. */
  it('holds an accepted password to the same floor as a sign-up', () => {
    const base = { token: 'T'.repeat(43), email: 'sam@example.com', name: 'Sam' };
    expect(inviteAcceptSchema.safeParse({ ...base, password: 'short' }).success).toBe(false);
    expect(inviteAcceptSchema.safeParse({ ...base, password: 'a-long-enough-one' }).success).toBe(true);
  });

  /**
   * The email is sent again rather than taken from the invite. The token
   * proves someone has the link; the email proves they are who it was for.
   */
  it('requires the email again at acceptance', () => {
    expect(
      inviteAcceptSchema.safeParse({
        token: 'T'.repeat(43),
        password: 'a-long-enough-one',
        name: 'Sam',
      }).success,
    ).toBe(false);
  });
});

/**
 * The invite token itself.
 *
 * These are pure and need no database, which matters: the isolation suite that
 * exercises the routes needs a mongod, and the properties below are the ones
 * that make a leaked link safe. They should not be reachable only through a
 * suite that can skip.
 */
describe('the invite token', () => {
  it('is 256 bits from a CSPRNG, and never repeats', async () => {
    const { mintInviteToken } = await import('@homefarm/api/db/invites');

    const tokens = new Set(Array.from({ length: 500 }, () => mintInviteToken()));
    expect(tokens.size).toBe(500);

    // base64url of 32 bytes, unpadded.
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(t, 'base64url')).toHaveLength(32);
    }
  });

  /** A database disclosure must not hand over usable invites. */
  it('stores a hash that cannot be turned back into the token', async () => {
    const { hashInviteToken, mintInviteToken } = await import('@homefarm/api/db/invites');

    const token = mintInviteToken();
    const hash = hashInviteToken(token);

    expect(hash).not.toBe(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Deterministic, so presenting the token is the lookup.
    expect(hashInviteToken(token)).toBe(hash);
    expect(hashInviteToken(mintInviteToken())).not.toBe(hash);
  });

  /**
   * The email binding, which is what stops a leaked link being useful to a
   * stranger. Case and surrounding space are not a different person.
   */
  it('matches an email regardless of case and space, and nothing else', async () => {
    const { emailMatches } = await import('@homefarm/api/db/invites');

    expect(emailMatches('Sam@Example.test', ' sam@example.test ')).toBe(true);
    expect(emailMatches('sam@example.test', 'sam@example.tes')).toBe(false);
    expect(emailMatches('sam@example.test', 'someone@else.test')).toBe(false);
    // Different lengths must not throw — timingSafeEqual does, on raw input.
    expect(() => emailMatches('a@b.co', 'a-much-longer-address@example.test')).not.toThrow();
  });
});

/**
 * Join codes (A2.5) — the properties that make six characters defensible.
 *
 * `invites.ts` says flatly that no rate limit makes a guessable invite safe,
 * and it is right about a link that sits in a phone for a week. Every property
 * that makes this a different object is asserted here rather than asserted in
 * a comment: a short alphabet with no lookalikes, a short life, one use, and a
 * hash rather than the code on disk.
 */
describe('join codes', () => {
  it('draws from an alphabet with no character that can be misread', async () => {
    const { mintJoinCode } = await import('@homefarm/api/db/join-codes');

    for (let i = 0; i < 200; i += 1) {
      const code = mintJoinCode();
      expect(code).toHaveLength(JOIN_CODE_LENGTH);
      // Crockford: no I, L, O or U. Nothing reads as a one or a zero across a
      // yard, and nothing spells a word by accident.
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    }
  });

  it('reads a code the way somebody types it', () => {
    // The three substitutions people actually make, and case is not
    // information. A hand who types l for 1 is understood, not corrected.
    expect(normalizeJoinCode(' k4m9pt ')).toBe('K4M9PT');
    expect(normalizeJoinCode('O0IL1U')).toBe('00111V');
    expect(normalizeJoinCode('K4-M9 PT')).toBe('K4M9PT');
  });

  it('mints something different every time', async () => {
    const { mintJoinCode } = await import('@homefarm/api/db/join-codes');

    const seen = new Set(Array.from({ length: 500 }, () => mintJoinCode()));
    // Not a randomness test — a guard against a constant, which is the way
    // this fails silently and catastrophically.
    expect(seen.size).toBeGreaterThan(400);
  });

  it('stores a hash that cannot be turned back into the code', async () => {
    const { hashJoinCode, mintJoinCode } = await import('@homefarm/api/db/join-codes');

    const code = mintJoinCode();
    const hash = hashJoinCode(code);

    expect(hash).not.toBe(code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashJoinCode(code)).toBe(hash);
  });

  /**
   * The window is the other half of the argument, so it is worth pinning: a
   * code that lasted a day would need a much longer alphabet to be safe.
   */
  it('lives for minutes, not days', () => {
    expect(JOIN_CODE_TTL_MINUTES).toBeLessThanOrEqual(15);
    expect(JOIN_CODE_TTL_MINUTES).toBeGreaterThan(0);
  });

  it('takes a redemption that names everything a new account needs', () => {
    const base = {
      code: 'K4M9PT',
      email: 'pat@example.test',
      password: 'a properly long passphrase',
      name: 'Pat',
    };

    expect(joinCodeRedeemSchema.safeParse(base).success).toBe(true);
    // Short passwords are refused at the boundary, not at the database.
    expect(joinCodeRedeemSchema.safeParse({ ...base, password: 'short' }).success).toBe(false);
    // The redeemer does not get to name their own role.
    expect(joinCodeRedeemSchema.safeParse({ ...base, role: 'owner' }).success).toBe(false);
  });
});

/**
 * Claiming a farm (A2.2) — the one payload in this system carrying an orgId.
 */
describe('signup', () => {
  const base = {
    orgId: 'A'.repeat(26),
    orgName: 'Hollow Farm',
    email: 'sam@example.test',
    password: 'a properly long passphrase',
    name: 'Sam',
  };

  it('takes the id the device minted', () => {
    expect(signupSchema.safeParse(base).success).toBe(true);
  });

  it('refuses anything that is not a 26-character id', () => {
    expect(signupSchema.safeParse({ ...base, orgId: 'nope' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, orgId: '' }).success).toBe(false);
  });

  /**
   * `.strict()`, so a caller cannot smuggle a role in beside the org.
   * The claimant is the owner because the route says so, not because the
   * payload asked.
   */
  it('refuses a role, and refuses a farm with no name', () => {
    expect(signupSchema.safeParse({ ...base, role: 'owner' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, orgName: '' }).success).toBe(false);
  });
});
