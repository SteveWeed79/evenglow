import type { Collection } from 'mongodb';
import type { Role } from '@steading/contracts';
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
}

export interface OrgDoc {
  _id: string; // ULID
  name: string;
  createdAt: Date;
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
 * Removal is a disable, never a delete.
 *
 * Their records stay — a morning's egg logs do not stop being true because the
 * person who typed them left, and a delete would either orphan them or take
 * them with it. `requireMutationClaims` already refuses a disabled account on
 * every write, so access ends immediately.
 */
export async function disableUser(orgId: string, userId: string, at: Date): Promise<boolean> {
  const result = await (await users()).updateOne(
    { _id: userId, orgId, disabledAt: { $exists: false } },
    { $set: { disabledAt: at } },
  );
  return result.matchedCount === 1;
}
