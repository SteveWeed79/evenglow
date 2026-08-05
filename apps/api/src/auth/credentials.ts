import { z } from 'zod';
import type { Role } from '@steading/contracts';
import { findUserByEmail } from '../db/identity';
import { verifyPassword } from './password';

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
  if (!user || user.disabledAt) return null;

  /**
   * An account with no password cannot be entered with one.
   *
   * A Google-only account (A2.4) never set one, and there is nothing here to
   * compare against — so this is a refusal rather than a comparison against
   * undefined. It returns null like every other failure on this path, so it
   * does not become a way to ask which addresses use Google.
   */
  if (user.passwordHash === undefined) return null;

  if (!(await verifyPassword(user.passwordHash, parsed.data.password))) return null;

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
