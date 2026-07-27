import NextAuth from 'next-auth';
// Side-effect type import: the module has to be loaded before it can be
// augmented below.
import type {} from 'next-auth/jwt';
import Credentials from 'next-auth/providers/credentials';
import { isRole, type Role } from '@steading/contracts';
import { authorizeCredentials } from './credentials';

/**
 * Auth.js with the JWT session strategy.
 *
 * JWT is not a preference here, it is a requirement (T6): database sessions
 * cannot be validated offline, and they add a round trip to every request.
 * The claims below are what a device carries into an offline period.
 */

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

      // Lives in ./credentials so it can be exercised without booting the
      // whole auth framework.
      authorize: authorizeCredentials,
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
