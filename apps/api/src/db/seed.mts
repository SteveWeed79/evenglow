/**
 * `pnpm db:seed` — creates the first org and its owner.
 *
 * D7 is single-farm-first: there is no invite flow yet, so the first account
 * is made here rather than through the app.
 *
 * Usage:
 *   MONGODB_URI=... pnpm db:seed "Hollow Farm" owner@example.com 'a good password'
 *
 * Or, preferred by anything scripting this, through the environment:
 *   SEED_ORG, SEED_EMAIL, SEED_PASSWORD
 *
 * **The environment is the safer channel and exists for a concrete reason.**
 * Arguments have to survive whatever shell is between the caller and here, and
 * a farm name with a space in it silently shifts every later argument along —
 * which produced an account whose email was the second word of the farm name.
 * Argv is also world-readable in a process list, and one of these three values
 * is a password.
 */
import { ulid } from 'ulid';
import { hashPassword } from '../auth/password.ts';
import { db } from './client.ts';
import { findUserByEmail, insertOrg, insertUser, normalizeEmail } from './identity.ts';
import { applyIndexes } from './indexes.ts';

const [argOrg, argEmail, argPassword] = process.argv.slice(2);

const orgName = argOrg ?? process.env.SEED_ORG;
const email = argEmail ?? process.env.SEED_EMAIL;
const password = argPassword ?? process.env.SEED_PASSWORD;

if (!orgName || !email || !password) {
  console.error('Usage: pnpm db:seed "<org name>" <email> <password>');
  console.error('   or: set SEED_ORG, SEED_EMAIL and SEED_PASSWORD');
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
  // Exit 2, not 1: an account that is already there is a different outcome
  // from a seed that failed, and a caller that cannot tell them apart will
  // either re-prompt forever or record a success that never happened.
  process.exit(2);
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
