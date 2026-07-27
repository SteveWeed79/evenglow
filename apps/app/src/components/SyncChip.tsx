'use client';

import { useState } from 'react';
import { useSync } from '../hooks/useSync';
import type { SyncState } from '../sync/engine';
import { DiagnosticsSheet } from './DiagnosticsSheet';
import { RejectedInbox } from './RejectedInbox';

/**
 * Persistent sync status, top-right. Never blocks anything (R6).
 *
 * Queued work is damson, not red: a farm hand who sees red all morning learns
 * to ignore red, and then misses the one morning it means something.
 */

function copy(state: SyncState): string {
  switch (state.kind) {
    case 'synced':
      return 'Saved';
    case 'queued':
      return `${state.count} waiting`;
    case 'syncing':
      return `Sending ${state.count}`;
    case 'rejected':
      return `${state.count} need a look`;
  }
}

export function SyncChip(): React.ReactElement {
  const state = useSync();
  const [open, setOpen] = useState<'none' | 'diagnostics' | 'inbox'>('none');

  // When something needs a look, the chip goes straight to it. Making the
  // user find the inbox behind a diagnostics screen is how "user-visible"
  // becomes technically-true-but-not-really.
  const target = state.kind === 'rejected' ? 'inbox' : 'diagnostics';

  return (
    <>
      <button
        type="button"
        className="syncchip"
        data-state={state.kind}
        onClick={() => setOpen(target)}
        aria-haspopup="dialog"
        data-testid="sync-chip"
      >
        <span className="syncchip__dot" aria-hidden="true" />
        {copy(state)}
      </button>

      {open === 'diagnostics' ? <DiagnosticsSheet onClose={() => setOpen('none')} /> : null}
      {open === 'inbox' ? <RejectedInbox onClose={() => setOpen('none')} /> : null}
    </>
  );
}
