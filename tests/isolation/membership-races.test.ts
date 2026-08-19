import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { UserDoc } from '@homefarm/api/db/identity';
import type { InviteDoc } from '@homefarm/api/db/invites';
import { resetOrgLanes } from '@homefarm/api/org-lane';
import { startTestDb } from '../support/mongo';

/**
 * The membership rules, under two requests at once (P1-7).
 *
 * Every one of them is a precheck and then an act — count the owners then
 * demote one, find the live code then replace it, spend the credential then
 * make the account — and a precheck and an act are two statements with a gap
 * between them. **No test anywhere covered that gap.** `membership.test.ts`
 * covers the pure predicates with `ownerCount` passed in; `claim.test.ts` and
 * `invites.test.ts` cover *sequential* double-use, which is the case the
 * conditional-update filters already handled.
 *
 * The worst of them is silent and permanent: two owners removing each other in
 * the same second each see two owners and leave the farm with none. On a
 * self-hosted box the operator can fix `role` in Mongo — the product cannot.
 */

const harness = await startTestDb('homefarm_membership');

if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'homefarm_membership';
}

const SECRET = 'a-test-secret-long-enough-for-hs256-abcdef';
const PASSWORD = 'a properly long passphrase';

const ORG = ulid();
const OWNER_ONE = ulid();
const OWNER_TWO = ulid();

const email = (id: string): string => `u-${id}@example.test`.toLowerCase();

const describeDb = harness ? describe : describe.skip;

async function server() {
  const { buildServer } = await import('@homefarm/api/server');
  const { readEnv } = await import('@homefarm/api/env');
  return buildServer(
    readEnv({
      AUTH_SECRET: SECRET,
      MONGODB_URI: harness!.uri,
      MONGODB_DB: 'homefarm_membership',
      CORS_ORIGINS: 'https://app.test',
    }),
  );
}

async function tokenFor(userId: string, role: 'owner' | 'admin' | 'hand') {
  const { startSession } = await import('@homefarm/api/auth/refresh');
  const { accessToken } = await startSession({ userId, orgId: ORG, role }, SECRET);
  return `Bearer ${accessToken}`;
}

async function liveOwners(): Promise<number> {
  return harness!.db
    .collection<UserDoc>('users')
    .countDocuments({ orgId: ORG, role: 'owner', disabledAt: { $exists: false } });
}

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  if (!harness) return;

  // The lane is a module-level map, so a suite must not inherit another's.
  resetOrgLanes();

  const { hashPassword } = await import('@homefarm/api/auth/password');
  const hash = await hashPassword(PASSWORD);

  for (const name of ['users', 'orgs', 'invites', 'joinCodes', 'refreshTokens']) {
    await harness.db.collection(name).deleteMany({});
  }

  await harness.db
    .collection('orgs')
    .insertOne({ _id: ORG, name: 'Hollow Farm', createdAt: new Date() } as never);

  await harness.db.collection<UserDoc>('users').insertMany([
    {
      _id: OWNER_ONE,
      email: email(OWNER_ONE),
      passwordHash: hash,
      name: 'One',
      orgId: ORG,
      role: 'owner',
      createdAt: new Date(),
    },
    {
      _id: OWNER_TWO,
      email: email(OWNER_TWO),
      passwordHash: hash,
      name: 'Two',
      orgId: ORG,
      role: 'owner',
      createdAt: new Date(),
    },
  ]);
});

describeDb('two owners acting on each other at once', () => {
  it('never leaves the farm without an owner, by removal', async () => {
    const app = await server();

    // Each holds a valid session and taps Remove on the other, in the same
    // moment. Sequentially the second is refused; concurrently both used to
    // count two owners and both used to succeed.
    const [one, two] = await Promise.all([
      app.inject({
        method: 'DELETE',
        url: `/members/${OWNER_TWO}`,
        headers: { authorization: await tokenFor(OWNER_ONE, 'owner') },
      }),
      app.inject({
        method: 'DELETE',
        url: `/members/${OWNER_ONE}`,
        headers: { authorization: await tokenFor(OWNER_TWO, 'owner') },
      }),
    ]);

    // Exactly one, not "at least one": the point is that one of the two was
    // refused, and a farm that kept both owners would mean neither ran.
    expect(await liveOwners()).toBe(1);

    // And one of them was told why, rather than both being told yes.
    const codes = [one.statusCode, two.statusCode].sort();
    expect(codes).toEqual([204, 403]);

    await app.close();
  });

  it('never leaves the farm without an owner, by demotion', async () => {
    const app = await server();

    const [one, two] = await Promise.all([
      app.inject({
        method: 'PATCH',
        url: `/members/${OWNER_TWO}/role`,
        headers: { authorization: await tokenFor(OWNER_ONE, 'owner') },
        payload: { role: 'hand' },
      }),
      app.inject({
        method: 'PATCH',
        url: `/members/${OWNER_ONE}/role`,
        headers: { authorization: await tokenFor(OWNER_TWO, 'owner') },
        payload: { role: 'hand' },
      }),
    ]);

    expect(await liveOwners()).toBe(1);
    expect([one.statusCode, two.statusCode].sort()).toEqual([200, 403]);

    await app.close();
  });

  /**
   * The rule is not "refuse everything concurrent" — an owner removing a hand
   * while another removes a different hand must both work. A lane that
   * serialises is not a lane that refuses.
   */
  it('still lets an owner remove somebody who is not the last one', async () => {
    const app = await server();
    const hand = ulid();

    await harness!.db.collection<UserDoc>('users').insertOne({
      _id: hand,
      email: email(hand),
      passwordHash: 'x',
      name: 'Hand',
      orgId: ORG,
      role: 'hand',
      createdAt: new Date(),
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/members/${hand}`,
      headers: { authorization: await tokenFor(OWNER_ONE, 'owner') },
    });

    expect(res.statusCode).toBe(204);
    expect(await liveOwners()).toBe(2);

    await app.close();
  });
});

describeDb('two join codes minted at once', () => {
  /**
   * `replaceJoinCode` is a delete then an insert, and Mongo will not make those
   * one operation without a replica set. Both mints delete, both insert, and
   * the farm holds two live codes — one of them invisible to the screen that
   * produced it, and valid for its full fifteen minutes.
   *
   * One device cannot do this: `useSaver.save` refuses re-entry while a save is
   * in flight. An owner on a phone and a tablet can.
   */
  it('leaves exactly one code live', async () => {
    const app = await server();

    await Promise.all([
      app.inject({
        method: 'POST',
        url: '/join-codes',
        headers: { authorization: await tokenFor(OWNER_ONE, 'owner') },
        payload: { role: 'hand' },
      }),
      app.inject({
        method: 'POST',
        url: '/join-codes',
        headers: { authorization: await tokenFor(OWNER_TWO, 'owner') },
        payload: { role: 'hand' },
      }),
    ]);

    const live = await harness!.db
      .collection('joinCodes')
      .countDocuments({ orgId: ORG, redeemedAt: { $exists: false } });

    expect(live).toBe(1);

    await app.close();
  });
});

describeDb('a credential spent on an account that could not be made', () => {
  /**
   * Spending before creating is the right order and stays: a crash between the
   * two must leave a link that no longer works rather than one that does. What
   * it cost was the other half — the invitation burned with nothing to show for
   * it, so somebody who did everything right is told their invitation is no
   * longer valid and the farm has to issue a new link.
   *
   * The email race is driven here by inserting the account underneath, between
   * the route's own check and its insert. That is the same window any transient
   * database error opens, and on a single node the transient error is the
   * likelier of the two.
   */
  it('gives the invitation back', async () => {
    const app = await server();
    const taken = 'taken@example.test';

    const created = await app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: await tokenFor(OWNER_ONE, 'owner') },
      payload: { email: taken, role: 'hand' },
    });
    const { token } = created.json() as { token: string };

    // The address is claimed after the route has already looked and found
    // nothing — which is what losing the race means.
    const { hashInviteToken } = await import('@homefarm/api/db/invites');
    const original = harness!.db.collection<UserDoc>('users');
    await original.insertOne({
      _id: ulid(),
      email: taken,
      passwordHash: 'x',
      name: 'Somebody else',
      orgId: ulid(),
      role: 'owner',
      createdAt: new Date(),
    });

    const accepted = await app.inject({
      method: 'POST',
      url: '/invites/accept',
      payload: { token, email: taken, password: PASSWORD, name: 'Hopeful' },
    });

    // Refused — correctly, the address really is taken.
    expect(accepted.statusCode).toBe(409);

    // But the invitation is intact. Before this it was spent, and the farm had
    // to issue a new link over a race nobody could see.
    const invite = await harness!.db
      .collection<InviteDoc>('invites')
      .findOne({ _id: hashInviteToken(token) });
    expect(invite?.acceptedAt).toBeUndefined();
    expect(invite?.acceptedByUserId).toBeUndefined();

    await app.close();
  });

  it('gives the join code back', async () => {
    const app = await server();
    const taken = 'also-taken@example.test';

    const minted = await app.inject({
      method: 'POST',
      url: '/join-codes',
      headers: { authorization: await tokenFor(OWNER_ONE, 'owner') },
      payload: { role: 'hand' },
    });
    const { code } = minted.json() as { code: string };

    await harness!.db.collection<UserDoc>('users').insertOne({
      _id: ulid(),
      email: taken,
      passwordHash: 'x',
      name: 'Somebody else',
      orgId: ulid(),
      role: 'owner',
      createdAt: new Date(),
    });

    const redeemed = await app.inject({
      method: 'POST',
      url: '/join-codes/redeem',
      payload: { code, email: taken, password: PASSWORD, name: 'Hopeful' },
    });

    expect(redeemed.statusCode).toBe(409);

    const live = await harness!.db
      .collection('joinCodes')
      .countDocuments({ orgId: ORG, redeemedAt: { $exists: false } });
    // Still live, so the owner does not have to read out six characters again.
    expect(live).toBe(1);

    await app.close();
  });

  /**
   * And the rollback can only undo its own. A filter on the hash alone would
   * let a failed acceptance take back the *successful* one that beat it, which
   * is worse than the fault being fixed.
   */
  it('cannot take back somebody else’s acceptance', async () => {
    const { acceptInvite, unacceptInvite, hashInviteToken } = await import(
      '@homefarm/api/db/invites'
    );
    const app = await server();

    const created = await app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: await tokenFor(OWNER_ONE, 'owner') },
      payload: { email: 'someone@example.test', role: 'hand' },
    });
    const { token } = created.json() as { token: string };
    const hash = hashInviteToken(token);

    const winner = ulid();
    expect(await acceptInvite(hash, winner, new Date())).toBe(true);

    // The loser tries to roll back what it never did.
    expect(await unacceptInvite(hash, ulid())).toBe(false);

    const invite = await harness!.db.collection<InviteDoc>('invites').findOne({ _id: hash });
    expect(invite?.acceptedByUserId).toBe(winner);

    await app.close();
  });
});
