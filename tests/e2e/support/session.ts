// Re-exported from @auth/core/jwt, which is a transitive dependency and so is
// not directly importable under pnpm's strict layout.
import type { BrowserContext, Cookie } from '@playwright/test';
import { encode } from 'next-auth/jwt';

/**
 * Mints a valid Auth.js session cookie.
 *
 * The exit gate is about the offline engine, not about sign-in, and going
 * through the credentials form would require a live MongoDB. Signing the same
 * JWT the server would have issued exercises the real session path without
 * dragging a database into a browser test.
 */

export const AUTH_SECRET = process.env.AUTH_SECRET ?? 'phase-2-exit-gate-secret-value';

/** Non-HTTPS cookie name; the __Secure- prefix only applies over TLS. */
const COOKIE_NAME = 'authjs.session-token';

export interface TestIdentity {
  userId: string;
  orgId: string;
  role: 'owner' | 'admin' | 'hand';
  email: string;
}

export async function sessionCookie(
  identity: TestIdentity,
  origin: string,
): Promise<Cookie> {
  const maxAge = 60 * 60;

  const token = await encode({
    secret: AUTH_SECRET,
    // Auth.js derives the encryption key from secret + salt, and uses the
    // cookie name as the salt.
    salt: COOKIE_NAME,
    maxAge,
    token: {
      sub: identity.userId,
      name: 'Gate Test',
      email: identity.email,
      orgId: identity.orgId,
      role: identity.role,
    },
  });

  const url = new URL(origin);

  return {
    name: COOKIE_NAME,
    value: token,
    domain: url.hostname,
    path: '/',
    expires: Math.floor(Date.now() / 1000) + maxAge,
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  };
}

export async function signIn(
  context: BrowserContext,
  origin: string,
  identity: TestIdentity,
): Promise<void> {
  await context.addCookies([await sessionCookie(identity, origin)]);
}
