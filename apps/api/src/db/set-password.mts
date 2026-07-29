/**
 * `pnpm db:password` — sets an existing account's password.
 *
 * The product has no reset flow (D7 is single-farm-first, and the first account
 * is made by `pnpm db:seed`), which left one state unrecoverable: an account
 * whose stored password is not what its owner typed. That is not hypothetical —
 * `pnpm farm` passed the password as a shell argument on Windows, where Node
 * hands arguments to `cmd.exe` unquoted, so anything after a space or an `&`
 * was dropped before it was ever hashed. The account existed and no password
 * would ever open it.
 *
 * Values come from the environment for the same reason the seed's do: a shell
 * must not get a chance to rewrite them, and argv is readable from a process
 * list.
 *
 *   SEED_EMAIL=owner@example.com SEED_PASSWORD='a good password' pnpm db:password
 */
import { hashPassword } from '../auth/password.ts';
import { findUserByEmail, normalizeEmail, setPasswordHash } from './identity.ts';

const email = process.env.SEED_EMAIL;
const password = process.env.SEED_PASSWORD;

if (!email || !password) {
  console.error('Set SEED_EMAIL and SEED_PASSWORD.');
  process.exit(1);
}

if (password.length < 12) {
  console.error('Choose a password of at least 12 characters.');
  process.exit(1);
}

// Named separately from the update so "no such account" cannot be reported as
// a mysterious failure to write.
if (!(await findUserByEmail(email))) {
  console.error(`No account for ${normalizeEmail(email)}.`);
  process.exit(2);
}

if (!(await setPasswordHash(email, await hashPassword(password)))) {
  console.error(`Could not set the password for ${normalizeEmail(email)}.`);
  process.exit(1);
}

console.log(`Password set for ${normalizeEmail(email)}`);
process.exit(0);
