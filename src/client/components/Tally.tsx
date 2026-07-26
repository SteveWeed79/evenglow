'use client';

import { useCallback, useState } from 'react';

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
  onCommit: (value: number) => void | Promise<void>;
}

export function Tally({
  label,
  unit,
  steps = [1, 6, 12],
  initial = 0,
  onCommit,
}: TallyProps): React.ReactElement {
  const [count, setCount] = useState(initial);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const bump = useCallback((by: number) => {
    setCount((c) => Math.max(0, c + by));
    // Through a glove this is often the only proof the tap registered.
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(8);
  }, []);

  const commit = useCallback(async () => {
    if (count === 0) return;
    const committed = count;

    // Optimistic: clear immediately so the next tally can start, and let the
    // queue carry the work. Nothing here waits.
    setCount(0);
    await onCommit(committed);

    // One short, plain sentence — the whole whimsy allowance on this path.
    setConfirmation(`${committed} ${unit} in the basket.`);
    setTimeout(() => setConfirmation(null), 3_000);
  }, [count, unit, onCommit]);

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
        onClick={() => void commit()}
        disabled={count === 0}
        data-testid="tally-commit"
      >
        Log {count} {unit}
      </button>

      <p className="tally__confirmation" aria-live="polite">
        {confirmation ?? ' '}
      </p>
    </section>
  );
}
