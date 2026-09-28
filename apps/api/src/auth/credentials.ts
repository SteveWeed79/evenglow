import { z } from 'zod';
import type { Role } from '@homefarm/contracts';
import { randomUUID } from 'node:crypto';
import { findUserByEmail } from '../db/identity';
import { hashPassword, verifyPassword } from './password';

/**
 * Credential verification, extracted from the NextAuth config so it can be
 * called directly.
 *
 * This is the one path no user can avoid, and burying it in a provider object
 * is what let it go untested — reaching it meant booting the whole auth
 * framework, so nothing ever did.
 */

const credentialsSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(1024),
});

export interface AuthorizedUser {
  id: string;
  email: string;
  name: string;
  orgId: string;
  role: Role;
}

/**
 * Returns null for every failure — unknown email, wrong password, disabled
 * account, malformed input — so the response cannot be used to work out which
 * emails have accounts.
 */
export async function authorizeCredentials(raw: unknown): Promise<AuthorizedUser | null> {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return null;

  const user = await findUserByEmail(parsed.data.email);

  /**
   * An account with no password cannot be entered with one.
   *
   * A Google-only account (A2.4) never set one, and there is nothing here to
   * compare against — so this is a refusal rather than a comparison against
   * undefined. It returns null like every other failure on this path, so it
   * does not become a way to ask which addresses use Google.
   *
   * ## Refused at the same cost as a wrong password
   *
   * The body was one sentence for every failure and the *time* was not: an
   * unknown, disabled or Google-only address returned before argon2 ran,
   * while a real password account cost a full verify — tens of milliseconds a
   * stopwatch can see, which is the enumeration the uniform sentence exists
   * to prevent. `/auth/forgot` puts a floor under its whole response for the
   * same reason; here the honest cost is an argon2 verify, so every refusal
   * pays one, against a digest no password matches when there is no account
   * to check.
   */
  const digest =
    user === null || user.disabledAt || user.passwordHash === undefined
      ? null
      : user.passwordHash;
  const matches = await verifyPassword(digest ?? (await decoyDigest()), parsed.data.password);
  if (user === null || digest === null || !matches) return null;

  // orgId and role come off the user document. Anything the caller sent
  // alongside the password is ignored (invariant 2).
  return {
    id: user._id,
    email: user.email,
    name: user.name,
    orgId: user.orgId,
    role: user.role,
  };
}

/**
 * A digest no password matches, hashed once per process at the same cost as a
 * real one, so a refusal against it takes as long as a refusal against a real
 * account's. Random rather than fixed: a known digest is a known timing.
 */
let decoy: Promise<string> | null = null;
function decoyDigest(): Promise<string> {
  decoy ??= hashPassword(randomUUID());
  return decoy;
}
