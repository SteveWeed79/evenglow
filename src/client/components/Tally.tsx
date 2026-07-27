'use client';

import { useCallback, useState } from 'react';
import { describeLogFailure } from '@steading/app/sync/failure';

/**
 * The signature control (UX-SPEC §3).
 *
 * Steppers, never a numeric keyboard (R5). The commit never awaits the
 * network (R6) — onCommit is expected to return once the mutation is durable
 * locally, which is an IndexedDB write, not a request.
 */

export interface TallyProps {
  label: string;
  unit: string;
  steps?: readonly number[];
  initial?: number;
  /**
   * When set, committing takes a second deliberate tap and the value is
   * recorded as acknowledged. Used for an open withdrawal window (W2) — the
   * only case where a warning is allowed to cost a tap.
   */
  requireConfirm?: boolean;
  onCommit: (value: number, acknowledged: boolean) => void | Promise<void>;
}

export function Tally({
  label,
  unit,
  steps = [1, 6, 12],
  initial = 0,
  requireConfirm = false,
  onCommit,
}: TallyProps): React.ReactElement {
  const [count, setCount] = useState(initial);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const bump = useCallback((by: number) => {
    setCount((c) => Math.max(0, c + by));
    // A new tap means they are working the problem; the stale message would
    // otherwise sit under a count they are actively rebuilding.
    setFailure(null);
    // Through a glove this is often the only proof the tap registered.
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(8);
  }, []);

  const commit = useCallback(async () => {
    if (count === 0) return;

    // One confirm tap while a withdrawal is open. Not a modal, and not a
    // block — the log still happens, it is just deliberate.
    if (requireConfirm && !armed) {
      setArmed(true);
      return;
    }

    const committed = count;
    const acknowledged = requireConfirm;

    // Optimistic: clear immediately so the next tally can start, and let the
    // queue carry the work. Nothing here waits.
    setCount(0);
    setArmed(false);
    setFailure(null);

    try {
      await onCommit(committed, acknowledged);
    } catch (error) {
      /**
       * Put the count back. The optimistic clear above is correct while the
       * write succeeds, but on a throw it is indistinguishable from success —
       * the number goes to zero either way — and the mutation is NOT queued,
       * because enqueue aborts its transaction as a unit. Without this the
       * count is simply gone, silently, which is the exact failure this app
       * exists to prevent.
       */
      setCount(committed);
      setArmed(acknowledged);
      setFailure(describeLogFailure(error));
      return;
    }

    // One short, plain sentence — the whole whimsy allowance on this path.
    setConfirmation(`${committed} ${unit} in the basket.`);
    setTimeout(() => setConfirmation(null), 3_000);
  }, [count, unit, onCommit, requireConfirm, armed]);

  return (
    <section className="tally arch" aria-labelledby="tally-label">
      <p id="tally-label" className="label">
        {label}
      </p>

      <output className="tally__count" data-numeric aria-live="polite">
        {count}
      </output>
      <p className="tally__unit">{unit}</p>

      <div className="tally__steps">
        {steps.map((step) => (
          <button
            key={step}
            type="button"
            className="tally__step"
            onClick={() => bump(step)}
            data-testid={`tally-plus-${step}`}
          >
            +{step}
          </button>
        ))}
        <button
          type="button"
          className="tally__step"
          onClick={() => bump(-1)}
          aria-label="Subtract one"
          disabled={count === 0}
        >
          −
        </button>
      </div>

      <button
        type="button"
        className="tally__commit"
        data-armed={armed ? '' : undefined}
        onClick={() => void commit()}
        disabled={count === 0}
        data-testid="tally-commit"
      >
        {armed ? `Log ${count} ${unit} anyway` : `Log ${count} ${unit}`}
      </button>

      {failure ? (
        <p className="log-error" role="alert" data-testid="tally-error">
          {failure}
        </p>
      ) : null}

      <p className="tally__confirmation" aria-live="polite">
        {confirmation ?? ' '}
      </p>
    </section>
  );
}
