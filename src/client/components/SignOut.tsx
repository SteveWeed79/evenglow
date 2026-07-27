'use client';

import { useCallback, useEffect, useState } from 'react';
import { clearSession } from '@steading/app/sync/session';
import { unsentCount } from '@steading/app/sync/queue';

/**
 * Sign-out, which clears every local store (C5).
 *
 * Two things make this more than a link. First, the local wipe is the actual
 * tenant-isolation control on a shared device — server-side scoping does
 * nothing about the previous farm's records still sitting in this browser's
 * IndexedDB. Second, unsent work is destroyed by the wipe, so the user has to
 * be told before it happens rather than after.
 */
export function SignOut({ action }: { action: () => Promise<void> }): React.ReactElement {
  const [unsent, setUnsent] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [strandedOffline, setStrandedOffline] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    void unsentCount().then(setUnsent);
  }, [confirming]);

  const signOut = useCallback(async () => {
    setWorking(true);

    // Wipe first, and unconditionally. If the redirect happened first, a fast
    // back-button would land on a signed-out shell still holding the data —
    // and if the network is down, the wipe is the part that still matters.
    await clearSession();

    try {
      await action();
    } catch {
      // Ending the server session needs the network. The device is already
      // clean, which is the control that protects this device; say plainly
      // what is and is not done rather than pretending it worked.
      setWorking(false);
      setStrandedOffline(true);
    }
  }, [action]);

  if (!confirming) {
    return (
      <button
        type="button"
        className="sheet__button"
        onClick={() => setConfirming(true)}
        data-testid="sign-out"
      >
        Sign out
      </button>
    );
  }

  return (
    <section className="arch shell__card">
      <p className="label">Sign out</p>
      <p>This clears everything stored on this device.</p>

      {strandedOffline ? (
        <p className="sheet__warn" data-testid="sign-out-offline">
          Everything on this device is cleared. You are still signed in on the server until this
          device is back online — reconnect and sign out again to finish.
        </p>
      ) : null}

      {unsent !== null && unsent > 0 ? (
        <p className="sheet__error">
          {unsent} {unsent === 1 ? 'entry has' : 'entries have'} not reached the server yet.
          Signing out now loses {unsent === 1 ? 'it' : 'them'}. Wait for the chip to say Saved.
        </p>
      ) : null}

      <div className="sheet__actions">
        <button type="button" className="sheet__button" onClick={() => setConfirming(false)}>
          Stay signed in
        </button>
        <button
          type="button"
          className="sheet__button sheet__button--primary"
          onClick={() => void signOut()}
          disabled={working}
          data-testid="sign-out-confirm"
        >
          Sign out
        </button>
      </div>
    </section>
  );
}
