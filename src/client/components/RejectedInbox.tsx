'use client';

import { useCallback, useEffect, useState } from 'react';
import type { QueuedMutation } from '@steading/app/db/schema';
import { discardRejected, listRejected, retryRejected } from '@steading/app/sync/inbox';
import { nudge } from '@steading/app/sync/engine';

/**
 * The rejected-mutations inbox (A6).
 *
 * The rubric asks for rejections to be user-visible and re-editable, and a
 * count in a status chip is neither. This is where work that the server would
 * not take comes to be looked at — the whole point being that it never
 * evaporates quietly.
 *
 * Discarding is possible but deliberate: it is the user's call, never the
 * app's.
 */

function describe(mutation: QueuedMutation): string {
  const what = mutation.entity.replace(/([A-Z])/g, ' $1').toLowerCase();
  const verb = mutation.op === 'create' ? 'New' : mutation.op === 'update' ? 'Change to' : 'Removal of';
  return `${verb} ${what}`;
}

function when(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function RejectedInbox({ onClose }: { onClose: () => void }): React.ReactElement {
  const [items, setItems] = useState<QueuedMutation[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setItems(await listRejected());
  }, []);

  useEffect(() => {
    let live = true;
    void listRejected().then((found) => {
      if (live) setItems(found);
    });
    return () => {
      live = false;
    };
  }, []);

  const retry = useCallback(
    async (id: string) => {
      await retryRejected(id);
      nudge();
      await refresh();
    },
    [refresh],
  );

  const discard = useCallback(
    async (id: string) => {
      await discardRejected(id);
      setConfirming(null);
      await refresh();
    },
    [refresh],
  );

  return (
    <div className="sheet__scrim" role="dialog" aria-modal="true" aria-label="Items that need a look">
      <div className="sheet arch">
        <p className="label">Need a look</p>

        {items === null ? null : items.length === 0 ? (
          <p className="shell__note">Nothing needs attention. Everything has gone through.</p>
        ) : (
          <ul className="inbox">
            {items.map((item) => (
              <li key={item.id} className="inbox__item">
                <p className="inbox__what">{describe(item)}</p>
                <p className="label">{when(item.enqueuedAt)}</p>

                {/* The server's own words, plain and literal. */}
                <p className="inbox__reason">{item.rejectedReason ?? 'The server would not accept it.'}</p>

                {confirming === item.id ? (
                  <div className="sheet__actions">
                    <button type="button" className="sheet__button" onClick={() => setConfirming(null)}>
                      Keep it
                    </button>
                    <button
                      type="button"
                      className="sheet__button"
                      onClick={() => void discard(item.id)}
                      data-testid="inbox-discard-confirm"
                    >
                      Delete for good
                    </button>
                  </div>
                ) : (
                  <div className="sheet__actions">
                    <button
                      type="button"
                      className="sheet__button"
                      onClick={() => setConfirming(item.id)}
                    >
                      Discard
                    </button>
                    <button
                      type="button"
                      className="sheet__button sheet__button--primary"
                      onClick={() => void retry(item.id)}
                      data-testid="inbox-retry"
                    >
                      Try again
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="sheet__actions">
          <button type="button" className="sheet__button sheet__button--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
