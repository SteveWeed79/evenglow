'use client';

import { useCallback } from 'react';
import { laysEggs, type Species } from '@/lib/contracts/entities';
import { useLog } from '../hooks/useSync';
import { ServiceWorker } from './ServiceWorker';
import { SyncChip } from './SyncChip';
import { Tally } from './Tally';

/**
 * Phase 2 Today screen: enough surface to exercise the offline engine
 * end to end. Chores, milestones, and the real group picker are Phase 3.
 *
 * The egg Tally is offered per species rather than unconditionally — a goat
 * keeper opening this to an egg counter learns immediately that the app was
 * built for someone else.
 */
export function TodayShell({
  flockId,
  species = 'chicken',
}: {
  flockId: string;
  species?: Species;
}): React.ReactElement {
  const log = useLog();

  const logEggs = useCallback(
    async (count: number) => {
      await log({
        entity: 'eggLog',
        op: 'create',
        payload: { occurredAt: Date.now(), flockId, count },
      });
    },
    [log, flockId],
  );

  return (
    <>
      <ServiceWorker />

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

      {laysEggs(species) ? <Tally label="Eggs today" unit="eggs" onCommit={logEggs} /> : null}
    </>
  );
}
