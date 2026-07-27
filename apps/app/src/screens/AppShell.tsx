import { useState } from 'react';
import { SignOut } from '../components/SignOut';
import { SyncChip } from '../components/SyncChip';
import { IronShell } from './IronShell';
import { StockShell } from './StockShell';
import { TodayShell } from './TodayShell';

/**
 * The four tabs (UX-SPEC §4). Four, not six — every additional tab is a
 * decision made at 6am.
 *
 * Tabs are client-side state rather than routes on purpose. The whole bundle
 * ships inside the APK, so there is no first-visit fetch to avoid — but four
 * routes would still mean four back-stack entries, and Android's back button
 * landing a farmer on a different tab than the one they left is a worse
 * outcome than a shallow history.
 */

const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'stock', label: 'Stock' },
  { id: 'iron', label: 'Iron' },
  { id: 'more', label: 'More' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function AppShell({ signOutAction }: { signOutAction: () => Promise<void> }): React.ReactElement {
  const [tab, setTab] = useState<TabId>('today');

  return (
    <>
      <main className="shell">
        {/* Status only — never actions (R3). */}
        <header className="shell__status">
          <p className="label">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}
          </p>
          <SyncChip />
        </header>

        {tab === 'today' ? <TodayShell /> : null}
        {tab === 'stock' ? <StockShell /> : null}
        {tab === 'iron' ? <IronShell /> : null}
        {tab === 'more' ? <More signOutAction={signOutAction} /> : null}
      </main>

      <nav className="tabs" aria-label="Sections">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className="tabs__tab"
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
            data-testid={`tab-${id}`}
          >
            {label}
          </button>
        ))}
      </nav>
    </>
  );
}

function More({ signOutAction }: { signOutAction: () => Promise<void> }): React.ReactElement {
  return (
    <>
      <section className="arch shell__card">
        <p className="label">More</p>
        <p className="shell__note">
          Inventory, reports, and export arrive with Phase 4. Sync diagnostics are behind the chip
          at the top of any screen.
        </p>
      </section>

      <SignOut action={signOutAction} />
    </>
  );
}
