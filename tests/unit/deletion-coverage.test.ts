import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { deleteAccountOn, deleteFarmOn } from '@homefarm/api/db/deletion';
import { COLLECTIONS } from '@homefarm/api/db/scoped';
import type { UserDoc } from '@homefarm/api/db/identity';

/**
 * What a deletion actually touches, with no mongod present.
 *
 * Account deletion is the one operation in this service that has to reach every
 * collection at once, and the two ways it can be wrong are both silent:
 *
 * **It misses one.** A farm that asked to be forgotten leaves a collection of
 * its records behind, with nothing pointing at them and nobody able to ask. The
 * likeliest way in is an entity added to `COLLECTIONS` a year from now, so the
 * assertion below is written against that list rather than against a list of
 * names copied into this file — a second copy would be exactly the thing that
 * goes stale, and it would go stale in the safe-looking direction.
 *
 * **It reaches too far.** A `deleteMany({})` where a scoped filter was meant
 * takes the neighbours with it. That is the worst outcome this repository has,
 * so every filter is recorded and checked for a tenant key rather than trusted.
 *
 * Driven against a fake `Db` for `photo-stamp-gate.test.ts`'s reason: the
 * database-backed suite covers the behaviour end to end in CI, and this covers
 * the coverage everywhere, including a laptop with no binary to download.
 */

const ORG = 'org-being-deleted';
const OWNER = 'user-owner';
const HAND = 'user-hand';

interface Call {
  collection: string;
  op: 'deleteMany' | 'deleteOne' | 'find' | 'findOne' | 'countDocuments';
  filter: Record<string, unknown>;
}

/**
 * Enough Mongo to run a deletion through, recording every call.
 *
 * `members` is what the users collection hands back to the sweep, so a test can
 * set the farm's roster; `otherOwner` is what `hasAnotherOwner`'s lookup finds.
 */
function fakeDb(options: { members?: string[]; otherOwner?: boolean; disabled?: string[] } = {}): {
  db: Db;
  calls: Call[];
} {
  const calls: Call[] = [];
  const members = options.members ?? [OWNER];
  const disabled = new Set(options.disabled ?? []);

  const collection = (name: string) => ({
    deleteMany: (filter: Record<string, unknown>) => {
      calls.push({ collection: name, op: 'deleteMany', filter });
      return Promise.resolve({ deletedCount: 1 });
    },
    deleteOne: (filter: Record<string, unknown>) => {
      calls.push({ collection: name, op: 'deleteOne', filter });
      return Promise.resolve({ deletedCount: 1 });
    },
    findOne: (filter: Record<string, unknown>) => {
      calls.push({ collection: name, op: 'findOne', filter });
      // Only `hasAnotherOwner` asks, and only of `users`.
      return Promise.resolve(options.otherOwner === true ? { _id: 'somebody-else' } : null);
    },
    find: (filter: Record<string, unknown>) => {
      calls.push({ collection: name, op: 'find', filter });
      return {
        toArray: () =>
          Promise.resolve(
            members.map((_id) =>
              disabled.has(_id) ? { _id, disabledAt: new Date() } : { _id },
            ),
          ),
      };
    },
    countDocuments: (filter: Record<string, unknown>) => {
      calls.push({ collection: name, op: 'countDocuments', filter });
      return Promise.resolve(members.length);
    },
  });

  return { db: { collection } as unknown as Db, calls };
}

/** The photo bucket, which a deletion has to empty and this has to prove. */
function fakeBytes(): { removeAll: () => Promise<number>; emptied: () => boolean } {
  let called = false;
  return {
    removeAll: () => {
      called = true;
      return Promise.resolve(3);
    },
    emptied: () => called,
  };
}

function user(over: Partial<UserDoc> = {}): UserDoc {
  return {
    _id: OWNER,
    email: 'keeper@example.test',
    name: 'The keeper',
    orgId: ORG,
    role: 'owner',
    createdAt: new Date(),
    ...over,
  };
}

describe('deleting a farm', () => {
  /**
   * The assertion this file exists for. `COLLECTIONS` is the source, so an
   * entity added to `scoped.ts` is covered the day it exists rather than the
   * day somebody remembers this test.
   */
  it('sweeps every tenant collection there is', async () => {
    const { db, calls } = fakeDb();
    await deleteFarmOn(db, ORG, OWNER, fakeBytes());

    const swept = new Set(
      calls.filter((call) => call.op === 'deleteMany').map((call) => call.collection),
    );

    for (const name of COLLECTIONS) {
      expect(swept, `${name} was left behind`).toContain(name);
    }
  });

  /**
   * The other direction, and the one that would be a catastrophe rather than a
   * loose end: nothing may be deleted without a tenant key in its filter.
   *
   * Checked structurally rather than by naming the filters, because the failure
   * being guarded against is somebody writing `deleteMany({})` — which is
   * type-valid, reads as tidy, and takes every farm on the box.
   */
  it('scopes every delete to this farm or to one of its people', async () => {
    const { db, calls } = fakeDb({ members: [OWNER, HAND] });
    await deleteFarmOn(db, ORG, OWNER, fakeBytes());

    const people = new Set([OWNER, HAND]);

    for (const call of calls) {
      if (call.op !== 'deleteMany' && call.op !== 'deleteOne') continue;

      const scoped =
        call.filter['orgId'] === ORG ||
        people.has(call.filter['userId'] as string) ||
        people.has(call.filter['_id'] as string) ||
        // The farm's own row, which is named by its id rather than scoped by it.
        (call.collection === 'orgs' && call.filter['_id'] === ORG);

      expect(scoped, `${call.op} on ${call.collection} was not scoped`).toBe(true);
    }
  });

  /** The bytes are not rows and no sweep of collections reaches them. */
  it('empties the photo bucket', async () => {
    const { db } = fakeDb();
    const bytes = fakeBytes();

    await deleteFarmOn(db, ORG, OWNER, bytes);

    expect(bytes.emptied()).toBe(true);
  });

  /**
   * Everything that could let somebody back into a farm that no longer exists.
   * An invite outliving its org would accept into nothing; a join code the same.
   */
  it('takes the invitations and join codes with it', async () => {
    const { db, calls } = fakeDb();
    await deleteFarmOn(db, ORG, OWNER, fakeBytes());

    const swept = calls.filter((call) => call.op === 'deleteMany').map((c) => c.collection);
    expect(swept).toContain('invites');
    expect(swept).toContain('joinCodes');
  });

  /** And every member's sessions, so a live token cannot outlive the farm. */
  it('deletes each member and their sessions', async () => {
    const { db, calls } = fakeDb({ members: [OWNER, HAND] });
    await deleteFarmOn(db, ORG, OWNER, fakeBytes());

    for (const id of [OWNER, HAND]) {
      expect(calls).toContainEqual({
        collection: 'refreshTokens',
        op: 'deleteMany',
        filter: { userId: id },
      });
      expect(calls).toContainEqual({ collection: 'users', op: 'deleteOne', filter: { _id: id } });
    }
  });

  /** The farm's own row goes last, so any interruption leaves a retryable state. */
  it('removes the farm itself, after its members', async () => {
    const { db, calls } = fakeDb({ members: [OWNER, HAND] });
    await deleteFarmOn(db, ORG, OWNER, fakeBytes());

    const org = calls.findIndex((c) => c.collection === 'orgs' && c.op === 'deleteOne');
    const lastUser = calls.map((c) => c.collection).lastIndexOf('users');

    expect(org).toBeGreaterThan(-1);
    expect(org).toBeGreaterThan(lastUser);
  });

  /** The number the owner was warned about, counting everybody but themselves. */
  it('reports how many other accounts went with it', async () => {
    const { db } = fakeDb({ members: [OWNER, HAND, 'user-third'] });
    const outcome = await deleteAccountOn(db, user(), fakeBytes());

    expect(outcome).toEqual({ deleted: 'farm', members: 2 });
  });

  /**
   * People who lose something, which is not the same as rows.
   *
   * A removed member's row goes too — the farm is gone, so there is nothing for
   * it to be the history of — but `disableUser` already ended their access and
   * released their address, and says somebody who comes back comes back as a
   * new account. Counting them would tell an owner that three other accounts go
   * when one of them stopped being an account in March, which is the sort of
   * number that makes a person stop trusting the screen.
   */
  it('does not count members who were already removed', async () => {
    const { db, calls } = fakeDb({
      members: [OWNER, HAND, 'user-third'],
      disabled: ['user-third'],
    });

    const outcome = await deleteAccountOn(db, user(), fakeBytes());

    expect(outcome).toEqual({ deleted: 'farm', members: 1 });
    // Their row is still deleted, which is the half the count must not imply.
    expect(calls).toContainEqual({
      collection: 'users',
      op: 'deleteOne',
      filter: { _id: 'user-third' },
    });
  });
});

describe('deleting an account that is not the farm’s last owner', () => {
  /**
   * The rule in one line: a hand's account is membership of somebody else's
   * farm, so leaving takes the person and not the records.
   */
  it('takes the person and leaves the farm alone', async () => {
    const { db, calls } = fakeDb();
    const outcome = await deleteAccountOn(db, user({ _id: HAND, role: 'hand' }), fakeBytes());

    expect(outcome).toEqual({ deleted: 'member' });

    const touched = new Set(
      calls.filter((c) => c.op === 'deleteMany' || c.op === 'deleteOne').map((c) => c.collection),
    );
    // Not one tenant collection, and not the farm.
    for (const name of COLLECTIONS) expect(touched).not.toContain(name);
    expect(touched).not.toContain('orgs');
  });

  /** An owner with a co-owner is in the same position: the farm has somebody left. */
  it('leaves the farm when another owner remains', async () => {
    const { db, calls } = fakeDb({ otherOwner: true });
    const outcome = await deleteAccountOn(db, user(), fakeBytes());

    expect(outcome).toEqual({ deleted: 'member' });
    expect(calls.some((c) => c.collection === 'orgs' && c.op === 'deleteOne')).toBe(false);
  });

  /** And the bytes stay, because they are the farm's rather than the person's. */
  it('does not empty the farm’s photo bucket', async () => {
    const { db } = fakeDb({ otherOwner: true });
    const bytes = fakeBytes();

    await deleteAccountOn(db, user(), bytes);

    expect(bytes.emptied()).toBe(false);
  });

  /**
   * A disabled owner cannot act, so a farm whose only other owner was removed
   * has nobody left — `countOwners` draws the same line and for the same reason.
   */
  it('asks only about owners who are still active', async () => {
    const { db, calls } = fakeDb({ otherOwner: false });
    await deleteAccountOn(db, user(), fakeBytes());

    const asked = calls.find((c) => c.collection === 'users' && c.op === 'findOne');
    expect(asked?.filter).toMatchObject({
      orgId: ORG,
      role: 'owner',
      disabledAt: { $exists: false },
    });
  });
});
