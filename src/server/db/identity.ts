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

export async function insertOrg(org: OrgDoc): Promise<void> {
  await (await orgs()).insertOne(org);
}

export async function findOrgById(id: string): Promise<OrgDoc | null> {
  return (await orgs()).findOne({ _id: id });
}
