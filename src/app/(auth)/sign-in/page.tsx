import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { signIn } from '@/server/auth/config';

export const runtime = 'nodejs';

/**
 * Sign-in. Deliberately plain: this is the one screen where a keyboard is
 * unavoidable, so it gets out of the way rather than performing warmth.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}): Promise<React.ReactElement> {
  const { error } = await searchParams;

  async function signInAction(formData: FormData): Promise<void> {
    'use server';

    try {
      await signIn('credentials', {
        email: formData.get('email'),
        password: formData.get('password'),
        redirectTo: '/',
      });
    } catch (caught) {
      // signIn signals a successful redirect by throwing, so only genuine
      // auth failures are turned into a message.
      if (caught instanceof AuthError) redirect('/sign-in?error=1');
      throw caught;
    }
  }

  return (
    <main className="signin">
      <h1 className="signin__title">Steading</h1>
      <p className="signin__sub">Stock, iron, and chores under one roofline.</p>

      <form action={signInAction} className="signin__form">
        {/* Plain and literal — charm here would be an insult (UX-SPEC §6). */}
        {error ? (
          <p className="signin__error" role="alert">
            That email and password do not match.
          </p>
        ) : null}

        <label className="label" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required />

        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />

        <button type="submit" className="signin__submit">
          Sign in
        </button>
      </form>
    </main>
  );
}
