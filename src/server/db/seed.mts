/**
 * `pnpm db:seed` — creates the first org and its owner.
 *
 * D7 is single-farm-first: there is no invite flow yet, so the first account
 * is made here rather than through the app.
 *
 * Usage:
 *   MONGODB_URI=... pnpm db:seed "Hollow Farm" owner@example.com 'a good password'
 */
import { ulid } from 'ulid';
import { hashPassword } from '../auth/password.ts';
import { db } from './client.ts';
import { findUserByEmail, insertOrg, insertUser, normalizeEmail } from './identity.ts';
import { applyIndexes } from './indexes.ts';

const [orgName, email, password] = process.argv.slice(2);

if (!orgName || !email || !password) {
  console.error('Usage: pnpm db:seed "<org name>" <email> <password>');
  process.exit(1);
}

if (password.length < 12) {
  console.error('Choose a password of at least 12 characters.');
  process.exit(1);
}

// Indexes first: the unique index on email is what makes the check below race-safe.
await applyIndexes(await db());

if (await findUserByEmail(email)) {
  console.error(`A user already exists for ${normalizeEmail(email)}.`);
  process.exit(1);
}

const orgId = ulid();
await insertOrg({ _id: orgId, name: orgName, createdAt: new Date() });

const userId = ulid();
await insertUser({
  _id: userId,
  email,
  passwordHash: await hashPassword(password),
  name: orgName,
  orgId,
  role: 'owner',
  createdAt: new Date(),
});

console.log(`Created org "${orgName}" (${orgId})`);
console.log(`Created owner ${normalizeEmail(email)} (${userId})`);
process.exit(0);
