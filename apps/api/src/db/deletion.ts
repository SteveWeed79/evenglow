import type { Db } from 'mongodb';
import type { DeletionOutcome } from '@homefarm/contracts';
import { blobsFor } from './blobs';
import { db } from './client';
import type { UserDoc } from './identity';
import { COLLECTIONS } from './scoped';

/**
 * Deleting an account, at the request of the person it belongs to.
 *
 * `docs/ACCOUNT-DELETION.md` holds the decision; `contracts/deletion.ts` the
 * rule in one line — the last owner takes the farm with them, anybody else
 * takes only themselves. This file is the writes.
 *
 * ## Here rather than in a route, for `scoped`'s reason
 *
 * Every collection handle in this service lives in `db/`, and this is the one
 * operation that has to touch all of them: the thirty tenant collections, the
 * photo bucket, and the six identity-side collections that are keyed by user or
 * by org rather than tenanted. Lint permits a handle only in this directory,
 * which is what keeps the list in one file and keeps the deliberate
 * cross-collection sweep beside the other deliberate ones (`farms.ts`,
 * `board.ts`) rather than scattered.
 *
 * **The tenant sweep is driven by `COLLECTIONS`, never by a list written here.**
 * A collection added to `scoped.ts` next year is deleted by this file the day it
 * exists; a second copy of the list would be one that forgot it, and a farm
 * that asked to be deleted would leave a collection of its records behind with
 * nothing pointing at them. `tests/unit/deletion-coverage.test.ts` asserts the
 * sweep touches every name.
 *
 * ## The mutation log goes too, and this is the one place it may
 *
 * Invariant 7 — never delete a mutation row — is about a device's outbox: the
 * history is the audit trail and the duplicate defence. The server's log is the
 * same audit trail and the replication feed, and it survives every other
 * operation in this service, including a member's removal and a record's
 * archive. It does not survive the farm asking to be forgotten, because an
 * audit trail of a farm that has asked not to exist is precisely the thing the
 * request is about. The ids inside it are ULIDs and nothing else can ever
 * mint the same ones, so nothing can replay into the gap.
 *
 * ## Not transactional, and what that costs
 *
 * A standalone mongod has no multi-document transaction, so this is a sequence
 * of deletes that can be interrupted. The order is chosen so that any prefix
 * leaves a state a retry finishes: the tenant records and bytes first, the
 * identity rows last. A farm half-deleted still has its owner, who is still
 * signed in, and the route reads as "try again" — where the other order would
 * leave records with no owner, which nothing could ever reach to finish.
 */

/** What a caller has to hand in for the photo bucket. Injectable for tests. */
interface Bytes {
  removeAll(): Promise<number>;
}

/**
 * Every user, session, code and invitation on a farm, then the farm.
 *
 * Returns how many *other* accounts went with it — the number the owner was
 * warned about, so the answer can be checked against the warning.
 */
export async function deleteFarmOn(
  database: Db,
  orgId: string,
  actorId: string,
  bytes: Bytes,
): Promise<number> {
  for (const name of COLLECTIONS) {
    await database.collection(name).deleteMany({ orgId });
  }
  await bytes.removeAll();

  // Anything that can let somebody back in, before the accounts themselves:
  // an invite outliving its farm would accept into an org that no longer
  // exists, and a join code the same.
  await database.collection('invites').deleteMany({ orgId });
  await database.collection('joinCodes').deleteMany({ orgId });

  const members = await database
    .collection<UserDoc>('users')
    .find({ orgId }, { projection: { _id: 1, disabledAt: 1 } })
    .toArray();

  // Every row goes, disabled ones included: the farm is gone, so there is
  // nothing left for a removed person's row to be the history of.
  for (const member of members) await deleteUserRows(database, member._id);

  await database.collection<{ _id: string }>('orgs').deleteOne({ _id: orgId });

  /**
   * The count is of people who lose something, which is not the same as rows.
   *
   * A removed member's row is deleted too, and counting it would overstate the
   * warning: `disableUser` already released their address and ended their
   * access, and says in so many words that somebody who comes back comes back
   * as a new account. Telling an owner that three other accounts go when one of
   * them stopped being an account in March is the kind of number that makes
   * somebody stop trusting the screen.
   */
  return members.filter(
    (member) => member._id !== actorId && member.disabledAt === undefined,
  ).length;
}

/**
 * One person, and every row that is theirs and nobody else's.
 *
 * Rather than `disableUser`, which keeps the row so the farm can still say who
 * typed a record. That is right for a removal — the farm did it, and the farm
 * is entitled to its own history — and wrong here, where the person is asking
 * for their name to go. The records they wrote stay, naming a user id nothing
 * resolves any more, which is what "the farm keeps its records and the person
 * leaves" actually means.
 */
async function deleteUserRows(database: Db, userId: string): Promise<void> {
  // Sessions first, so a token presented mid-deletion meets a revoked family
  // rather than a user that has already gone. Deleted rather than revoked:
  // a revoked token is a row about a person, and the person has asked to go.
  await database.collection('refreshTokens').deleteMany({ userId });
  await database.collection('passwordResets').deleteMany({ userId });
  await database.collection('emailVerifications').deleteMany({ userId });
  await database.collection<UserDoc>('users').deleteOne({ _id: userId });
}

/**
 * Whether anybody else could own the farm once this person has gone.
 *
 * Active owners only, for `countOwners`' reason: a disabled owner cannot act,
 * so a farm whose only other owner was removed has no one left.
 */
async function hasAnotherOwner(database: Db, user: UserDoc): Promise<boolean> {
  const other = await database.collection<UserDoc>('users').findOne(
    { orgId: user.orgId, role: 'owner', disabledAt: { $exists: false }, _id: { $ne: user._id } },
    { projection: { _id: 1 } },
  );
  return other !== null;
}

/**
 * The decision and the writes, on an injected database.
 *
 * The caller has already proved the request is the account's own — a password
 * or a Google identity — and holds the farm's lane, so two owners deleting
 * themselves in the same second cannot both count the other as remaining.
 */
export async function deleteAccountOn(
  database: Db,
  user: UserDoc,
  bytes: Bytes,
): Promise<DeletionOutcome> {
  if (user.role === 'owner' && !(await hasAnotherOwner(database, user))) {
    const members = await deleteFarmOn(database, user.orgId, user._id, bytes);
    return { deleted: 'farm', members };
  }

  await deleteUserRows(database, user._id);
  return { deleted: 'member' };
}

/** App-facing entry point: the live database and the org's own bucket. */
export async function deleteAccount(user: UserDoc): Promise<DeletionOutcome> {
  return deleteAccountOn(await db(), user, await blobsFor(user.orgId));
}

/**
 * How many other accounts a deletion would take, said before it is done.
 *
 * The screen asks this so the warning carries a number rather than a clause —
 * "two other people lose their accounts on this farm" is a sentence somebody
 * weighs, and "other members may be affected" is one they scroll past. Zero
 * for anybody who is not the last owner, because their deletion takes nobody.
 */
export async function membersWhoWouldGo(user: UserDoc): Promise<number> {
  const database = await db();
  if (user.role !== 'owner' || (await hasAnotherOwner(database, user))) return 0;

  // Active members only, and the same rule `deleteFarmOn` reports by — the two
  // numbers are the same sentence said before and after, so they must not be
  // counted two ways.
  return database.collection<UserDoc>('users').countDocuments({
    orgId: user.orgId,
    _id: { $ne: user._id },
    disabledAt: { $exists: false },
  });
}
