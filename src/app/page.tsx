import Link from 'next/link';
import { AppShell } from '@steading/app/components/AppShell';
import { auth, signOut } from '@/server/auth/config';

export const runtime = 'nodejs';

/**
 * Home is today, not a dashboard (R2).
 *
 * Phase 2 puts the Tally and the sync status here so the offline engine has a
 * real path to exercise. The chore list, the flock picker, and the charm
 * layer arrive in Phase 3.
 *
 * A session is required before anything can be queued: a mutation enqueued
 * without one would be attributed to whoever signed in next, and the queue
 * must not outlive a session boundary (session hygiene, C5).
 */
export default async function Home(): Promise<React.ReactElement> {
  const session = await auth();

  if (!session?.user) {
    return (
      <main className="signin">
        <h1 className="signin__title">Steading</h1>
        <p className="signin__sub">Stock, iron, and chores under one roofline.</p>
        <Link href="/sign-in" className="tap signin__submit">
          Sign in
        </Link>
      </main>
    );
  }

  async function signOutAction(): Promise<void> {
    'use server';
    await signOut({ redirectTo: '/sign-in' });
  }

  return <AppShell signOutAction={signOutAction} />;
}
