'use client';

import { useCallback } from 'react';
import { useLog } from '../hooks/useSync';
import { ServiceWorker } from './ServiceWorker';
import { SyncChip } from './SyncChip';
import { Tally } from './Tally';

/**
 * Phase 2 Today screen: enough surface to exercise the offline engine
 * end to end. Chores, milestones, and the real flock picker are Phase 3.
 */
export function TodayShell({ flockId }: { flockId: string }): React.ReactElement {
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

      <Tally label="Eggs today" unit="eggs" onCommit={logEggs} />
    </>
  );
}
