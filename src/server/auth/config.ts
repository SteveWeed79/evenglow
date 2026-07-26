import NextAuth from 'next-auth';
// Side-effect type import: the module has to be loaded before it can be
// augmented below.
import type {} from 'next-auth/jwt';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { isRole, type Role } from '@/lib/contracts/roles';
import { findUserByEmail } from '@/server/db/identity';
import { verifyPassword } from './password';

/**
 * Auth.js with the JWT session strategy.
 *
 * JWT is not a preference here, it is a requirement (T6): database sessions
 * cannot be validated offline, and they add a round trip to every request.
 * The claims below are what a device carries into an offline period.
 */

const credentialsSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(1024),
});

declare module 'next-auth' {
  interface User {
    orgId: string;
    role: Role;
  }

  interface Session {
    user: {
      id: string;
      orgId: string;
      role: Role;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    orgId: string;
    role: Role;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/sign-in' },

  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },

      /**
       * Returns null for every failure mode — unknown email, wrong password,
       * disabled account — so the response cannot be used to enumerate users.
       */
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await findUserByEmail(parsed.data.email);
        if (!user || user.disabledAt) return null;

        const ok = await verifyPassword(user.passwordHash, parsed.data.password);
        if (!ok) return null;

        // orgId and role are read from the user document, never from input.
        return {
          id: user._id,
          email: user.email,
          name: user.name,
          orgId: user.orgId,
          role: user.role,
        };
      },
    }),
  ],

  callbacks: {
    jwt({ token, user }) {
      // `user` is present only on sign-in; afterwards the claims ride the token.
      if (user) {
        token.orgId = user.orgId;
        token.role = user.role;
      }
      return token;
    },

    session({ session, token }) {
      session.user.id = typeof token.sub === 'string' ? token.sub : '';
      session.user.orgId = typeof token.orgId === 'string' ? token.orgId : '';
      session.user.role = isRole(token.role) ? token.role : 'hand';
      return session;
    },
  },
});
