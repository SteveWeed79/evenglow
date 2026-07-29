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
  passwordHash: string;
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
