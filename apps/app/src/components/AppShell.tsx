'use client';

import { useState } from 'react';
import { IronShell } from './IronShell';
import { LampToggle } from './LampToggle';
import { ServiceWorker } from './ServiceWorker';
import { SignOut } from './SignOut';
import { StockShell } from './StockShell';
import { SyncChip } from './SyncChip';
import { TodayShell } from './TodayShell';

/**
 * The four tabs (UX-SPEC §4). Four, not six — every additional tab is a
 * decision made at 6am.
 *
 * Tabs are client-side state rather than routes on purpose. The Service
 * Worker precaches one shell; separate routes would each need the network on
 * first visit, which is the wrong trade for an app whose whole claim is that
 * it works with the radio off.
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
      <ServiceWorker />

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
          <div className="shell__lamps">
            <SyncChip />
            <LampToggle />
          </div>
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
        {/* Names what a keeper would look for, not the plan it lives in. */}
        <p className="shell__note">
          Inventory, reports, and export aren&rsquo;t here yet. Sync diagnostics live behind the
          chip at the top of any screen.
        </p>
      </section>

      <SignOut action={signOutAction} />
    </>
  );
}
