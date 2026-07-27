import { z } from 'zod';
import type { Role } from '@steading/contracts';
import { findUserByEmail } from '@/server/db/identity';
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
