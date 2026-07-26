import Link from 'next/link';
import { auth } from '@/server/auth/config';

export const runtime = 'nodejs';

/**
 * Phase 1 placeholder.
 *
 * Home is "today, not a dashboard" (R2), but the Today screen is Phase 3 work
 * and the charm layer is gated behind Phase 2's exit gate. What this screen
 * proves is the Phase 1 Definition of Done: sign-in issues a JWT carrying
 * orgId and role.
 */
export default async function Home(): Promise<React.ReactElement> {
  const session = await auth();

  if (!session?.user) {
    return (
      <main className="signin">
        <h1 className="signin__title">Steading</h1>
        <p className="signin__sub">Birds, iron, and chores in one place.</p>
        <Link href="/sign-in" className="tap signin__submit">
          Sign in
        </Link>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="shell__status">
        <p className="label">Signed in</p>
        <p>{session.user.email}</p>
      </header>

      <section className="arch shell__card">
        <p className="label">Session claims</p>
        <dl className="shell__claims" data-numeric>
          <dt className="label">Org</dt>
          <dd>{session.user.orgId}</dd>
          <dt className="label">Role</dt>
          <dd>{session.user.role}</dd>
        </dl>
      </section>

      <p className="shell__note">
        Foundation only. The Today screen, the Tally, and the offline queue arrive with Phases 2
        and 3.
      </p>
    </main>
  );
}
