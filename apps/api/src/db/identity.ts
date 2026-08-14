import type { Collection } from 'mongodb';
import type { Role, Subscription } from '@steading/contracts';
import { db } from './client';

/**
 * Identity collections are deliberately NOT tenant-scoped: sign-in has to find
 * a user before an orgId exists, so scoped() cannot serve this path.
 *
 * Because the generic guard does not apply here, this module exposes narrow
 * purpose-built functions instead of collection handles. It lives inside
 * server/db/ so the lint guard's exemption covers it, and there is no
 * general-purpose query in it by design.
 */

export interface UserDoc {
  _id: string; // ULID
  email: string; // lowercased, unique
  /**
   * Absent on an account that only ever signs in with Google (A2.4).
   *
   * Optional rather than a placeholder hash, because a placeholder is a
   * password-shaped thing somebody could eventually match. `authorizeCredentials`
   * refuses an account without one — a Google-only account cannot be entered
   * with a password, which is the whole point of not having set one.
   */
  passwordHash?: string;
  /**
   * Google's stable subject id, set the first time somebody signs in with it.
   *
   * The identity, where the email is only the label: Google's `sub` survives
   * somebody changing the address on their account, and an email does not.
   * Matching on email alone would mean an account silently changing hands the
   * day an address is recycled.
   */
  googleSub?: string;
  name: string;
  orgId: string;
  role: Role;
  createdAt: Date;
  disabledAt?: Date;
  /**
   * The address and the Google subject this account had before it was removed.
   *
   * Kept because the row is kept: a farm's records name who typed them, and
   * "who was that?" is a question somebody asks about a person who left. Moved
   * out of `email` and `googleSub` so they no longer identify a live account —
   * see `disableUser` for why removal has to release them.
   */
  formerEmail?: string;
  formerGoogleSub?: string;
}

export interface OrgDoc {
  _id: string; // ULID
  name: string;
  createdAt: Date;
  /**
   * What the farm has paid for, if anything (D13).
   *
   * Absent on every farm that has never subscribed, which is the ordinary
   * free-tier state and not a problem — `entitlementOf` reads an absent
   * subscription as `unsubscribed` rather than as a fault.
   */
  subscription?: Subscription;
  /**
   * The Play purchase token this farm's subscription came from.
   *
   * **Server-side only and deliberately not part of `Subscription`.** That
   * shape is shared with the client through the contracts package; this is
   * storage. Keeping it out means there is no route that could accidentally
   * serialise it into a response.
   *
   * Stored rather than hashed, because it is not a credential to be checked —
   * it is the handle this server presents to Google when asking what the
   * purchase is worth now, and a hash cannot be presented.
   */
  playPurchaseToken?: string;
  /**
   * Sync given away, by whoever runs this server (D13).
   *
   * The database half of `FREE_SYNC_ORGS`, and the reason it exists: the
   * environment variable works and requires a restart to change, so comping a
   * tester means editing a file and bouncing the service. That is fine when
   * the farm is your own and actively bad the first time somebody messages you
   * on a Sunday.
   *
   * **Still not requestable, which is the property that mattered.** The
   * masterplan's argument is against a *route* — "a grant that can be
   * requested is a grant that can be requested by anybody" — and nothing on
   * the wire reaches this field. It is written by `pnpm farm:grant`, which
   * needs a shell on the server, exactly like minting a promotion code does.
   *
   * The env list stays and still wins: a farm named there is granted whether
   * or not this field is set, so an operator locked out of the database can
   * still let somebody through.
   */
  syncGranted?: { at: Date; note?: string };
}

async function users(): Promise<Collection<UserDoc>> {
  return (await db()).collection<UserDoc>('users');
}

async function orgs(): Promise<Collection<OrgDoc>> {
  return (await db()).collection<OrgDoc>('orgs');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(email: string): Promise<UserDoc | null> {
  return (await users()).findOne({ email: normalizeEmail(email) });
}

export async function findUserById(id: string): Promise<UserDoc | null> {
  return (await users()).findOne({ _id: id });
}

/** By Google's stable subject id, which outlives a change of address. */
export async function findUserByGoogleSub(googleSub: string): Promise<UserDoc | null> {
  return (await users()).findOne({ googleSub });
}

/**
 * Binds a Google identity to an account that already exists.
 *
 * The upgrade path for a farm that signed up with a password and later taps
 * the Google button with the same address: the account is theirs either way,
 * and the alternative is telling them their own email is taken.
 *
 * Only ever called after the ID token has been verified, so the address is one
 * Google has confirmed the caller controls.
 */
export async function linkGoogleSub(userId: string, googleSub: string): Promise<void> {
  await (await users()).updateOne({ _id: userId }, { $set: { googleSub } });
}

export async function insertUser(user: UserDoc): Promise<void> {
  await (await users()).insertOne({ ...user, email: normalizeEmail(user.email) });
}

/**
 * Replaces a password hash, by email.
 *
 * There is no reset flow in the product yet — D7 is single-farm-first and the
 * first account is made by `pnpm db:seed` — so this exists for the one case
 * that is otherwise unrecoverable: a development account whose password was
 * stored as something other than what its owner typed. It takes a hash, never
 * a plaintext, so hashing parameters stay in one place.
 */
export async function setPasswordHash(email: string, passwordHash: string): Promise<boolean> {
  const result = await (await users()).updateOne(
    { email: normalizeEmail(email) },
    { $set: { passwordHash } },
  );
  return result.matchedCount === 1;
}

export async function findOrgById(id: string): Promise<OrgDoc | null> {
  return (await orgs()).findOne({ _id: id });
}

export async function insertOrg(org: OrgDoc): Promise<void> {
  await (await orgs()).insertOne(org);
}

/**
 * Renames a farm, and answers whether there was one to rename.
 *
 * Only the name. A `$set` of the whole document would carry whatever the caller
 * happened to be holding, and this collection also holds the subscription —
 * which is the one field on a farm that must never move because somebody
 * corrected a spelling.
 *
 * False means no such farm, which the route turns into a 404 rather than a
 * silent success. `matchedCount`, not `modifiedCount`: renaming a farm to the
 * name it already has modifies nothing and is not a failure.
 */
export async function renameOrg(id: string, name: string): Promise<boolean> {
  const result = await (await orgs()).updateOne({ _id: id }, { $set: { name } });
  return result.matchedCount > 0;
}

/**
 * Every farm on this server, newest first.
 *
 * For the operator commands only — there is no route that reaches it, and
 * there must not be: this is the one query in the codebase that deliberately
 * crosses tenants, which is why it lives here beside the other narrow,
 * purpose-built functions rather than behind a collection handle.
 */
export async function listOrgs(limit = 200): Promise<OrgDoc[]> {
  return (await orgs()).find({}).sort({ createdAt: -1 }).limit(limit).toArray();
}

/** Everyone on one farm, so `farm:show` can say who would be affected. */
export async function listUsersInOrg(orgId: string): Promise<UserDoc[]> {
  return (await users()).find({ orgId }).sort({ createdAt: 1 }).toArray();
}

/** Gives sync away, or takes it back. Null revokes. */
export async function setSyncGrant(
  orgId: string,
  grant: { at: Date; note?: string } | null,
): Promise<boolean> {
  const result = await (await orgs()).updateOne(
    { _id: orgId },
    grant === null ? { $unset: { syncGranted: '' } } : { $set: { syncGranted: grant } },
  );
  return result.matchedCount === 1;
}

/**
 * Records what a rail told us about this farm's subscription.
 *
 * Replaces wholesale rather than merging fields: a store notification
 * describes the whole current state, and merging would let a stale field from
 * a previous notification survive underneath a fresh one — which is exactly
 * how a farm ends up entitled by a value nobody remembers writing.
 */
export async function setSubscription(
  orgId: string,
  subscription: Subscription,
  playPurchaseToken?: string,
): Promise<void> {
  await (await orgs()).updateOne(
    { _id: orgId },
    { $set: { subscription, ...(playPurchaseToken === undefined ? {} : { playPurchaseToken }) } },
  );
}

/**
 * Which farm a purchase belongs to.
 *
 * A store notification names the purchase, never the customer — so the token
 * has to be matched back to the farm that submitted it. A token nobody has
 * submitted belongs to a purchase this server has never seen, which is either
 * a forgery or a signup that never finished, and both are nothing to act on.
 */
export async function findOrgIdByPurchaseToken(purchaseToken: string): Promise<string | null> {
  const org = await (await orgs()).findOne({ playPurchaseToken: purchaseToken }, { projection: { _id: 1 } });
  return org?._id ?? null;
}

/**
 * Whether anybody at all belongs to this org.
 *
 * The claim path's crash guard (A2.2). Creating a farm is two inserts — the
 * org, then its owner — and there is no transaction to wrap them in: tests run
 * against a standalone mongod, and requiring a replica set to create an
 * account would make the setup harder than the feature.
 *
 * So the second insert failing, or the process dying between them, leaves an
 * org with no users. That org is **unclaimed by definition**: no user means no
 * token can ever carry its id, which means no request can ever reach inside
 * it. Letting the same device finish the job it started is strictly better
 * than telling a farm its own id is taken and stranding every record on the
 * handset behind an id it can never claim.
 *
 * `findOne` rather than `countDocuments`: the question is existence, and a
 * count of a large org is work nobody asked for.
 */
export async function orgHasMembers(orgId: string): Promise<boolean> {
  return (await (await users()).findOne({ orgId }, { projection: { _id: 1 } })) !== null;
}

/**
 * Removes an org that was created seconds ago and could not be given an owner.
 *
 * Best-effort tidying, not a correctness mechanism — `orgHasMembers` is what
 * makes the half-created state recoverable. This just keeps the common failure
 * (an email already in use) from leaving a row behind at all.
 */
export async function deleteOrgIfEmpty(orgId: string): Promise<void> {
  if (await orgHasMembers(orgId)) return;
  await (await orgs()).deleteOne({ _id: orgId });
}

// ── membership ───────────────────────────────────────────────────────────────

/**
 * The org-scoped user reads.
 *
 * Every one takes orgId and puts it in the filter, and none of them takes a
 * filter from a caller. That is weaker than `scoped()`, which makes forgetting
 * structurally impossible — but this collection cannot be scoped, because
 * sign-in has to find a user before an orgId exists. `tests/isolation` covers
 * what the mechanism cannot.
 */

/** Members of one farm, newest first. Password hashes never leave this module. */
export async function listMembers(orgId: string): Promise<Omit<UserDoc, 'passwordHash'>[]> {
  return (await users())
    .find({ orgId }, { projection: { passwordHash: 0 } })
    .sort({ createdAt: 1 })
    .limit(200)
    .toArray() as Promise<Omit<UserDoc, 'passwordHash'>[]>;
}

/**
 * How many active owners a farm has.
 *
 * Disabled owners are not counted, deliberately: a farm whose only owner has
 * been disabled has no one who can act, so treating that account as the last
 * owner would let the state persist rather than surfacing it.
 */
export async function countOwners(orgId: string): Promise<number> {
  return (await users()).countDocuments({ orgId, role: 'owner', disabledAt: { $exists: false } });
}

/** Scoped by orgId, so a token from one farm cannot move a role on another. */
export async function setUserRole(orgId: string, userId: string, role: Role): Promise<boolean> {
  const result = await (await users()).updateOne({ _id: userId, orgId }, { $set: { role } });
  return result.matchedCount === 1;
}

/**
 * Removal is a disable, never a delete — and it gives the address back.
 *
 * Their records stay: a morning's egg logs do not stop being true because the
 * person who typed them left, and a delete would either orphan them or take
 * them with it. `requireMutationClaims` already refuses a disabled account on
 * every write, so access ends immediately.
 *
 * ## Why the email has to move
 *
 * **Reported from a farm: somebody who joined with a code and was then removed
 * could not create a farm of their own.** They could not do anything at all.
 * `email` is globally unique, so the disabled row went on owning the address;
 * sign-in refused it for being disabled, and signup refused it for existing —
 * with the one message that makes the trap airtight, *"that email already has a
 * Steading account, sign in with it instead"*, which is advice to do the thing
 * that also fails. One removal burned an address permanently.
 *
 * So removal releases it. The row keeps the name and the history; the address
 * stops pointing at an account nobody can enter.
 *
 * `removed:<userId>` rather than unsetting it. The unique index is not sparse,
 * so two removed people would both hold `null` and the second removal would
 * fail — and a colon cannot appear before the `@` in an address, so this token
 * can never collide with somebody's real one.
 *
 * **Google's subject id goes with it**, or the release is half a release: a
 * tester who signed up with Google would still be found by `findUserByGoogleSub`
 * and 401'd, having freed an address they never used.
 *
 * This is one-way, as removal already was — nothing in this service clears
 * `disabledAt`. Somebody who comes back comes back as a new account, which is
 * what "removed from the farm" means.
 */
export async function disableUser(orgId: string, userId: string, at: Date): Promise<boolean> {
  const found = await (await users()).findOne({ _id: userId, orgId, disabledAt: { $exists: false } });
  if (!found) return false;

  const result = await (await users()).updateOne(
    { _id: userId, orgId, disabledAt: { $exists: false } },
    {
      $set: {
        disabledAt: at,
        // `email` is required on the document, so it is always there to keep.
        // `googleSub` is not — an account that only ever used a password has
        // none, and writing `formerGoogleSub: undefined` would store a null.
        formerEmail: found.email,
        email: `removed:${userId}`,
        ...(found.googleSub === undefined ? {} : { formerGoogleSub: found.googleSub }),
      },
      $unset: { googleSub: '' },
    },
  );
  return result.matchedCount === 1;
}
