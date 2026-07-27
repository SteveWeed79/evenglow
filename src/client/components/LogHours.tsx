'use client';

import { useCallback, useState } from 'react';
import { useLog } from '../hooks/useSync';
import type { Machine } from '../read/iron';

/**
 * Records an hour-meter reading.
 *
 * An hour meter reads in the hundreds or thousands, so R5's stepper rule
 * gives way to a keyboard here — the rule's own exception is values that can
 * exceed 99. What the steppers do instead is nudge from the last reading,
 * which is how the number is usually entered: the meter has moved a few hours
 * since Tuesday, not a few thousand.
 */
export function LogHours({
  machine,
  onDone,
}: {
  machine: Machine;
  onDone: () => void;
}): React.ReactElement {
  const log = useLog();
  const [value, setValue] = useState(machine.hours === null ? '' : String(machine.hours));
  const [saving, setSaving] = useState(false);

  const hours = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(hours) && hours >= 0;

  // Checked here as well as on the server, so the mistake is caught while the
  // meter is still in front of you rather than at the next flush.
  const tooLow = valid && machine.hours !== null && hours < machine.hours;

  const nudge = useCallback((by: number) => {
    setValue((current) => {
      const base = Number(current);
      return String(Math.max(0, (Number.isFinite(base) ? base : 0) + by));
    });
  }, []);

  async function save(): Promise<void> {
    if (saving || !valid || tooLow) return;
    setSaving(true);

    await log({
      entity: 'hourReading',
      op: 'create',
      payload: { occurredAt: Date.now(), equipmentId: machine.id, hours },
    });

    onDone();
  }

  return (
    <section className="addgroup">
      <p className="label">Hours on {machine.name}</p>

      <input
        id="hours"
        type="number"
        inputMode="decimal"
        min={0}
        step="0.1"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={`Hour meter reading for ${machine.name}`}
        data-testid="hours-input"
      />

      <div className="addgroup__chips">
        {[1, 5, 10].map((step) => (
          <button
            key={step}
            type="button"
            className="tally__step"
            onClick={() => nudge(step)}
            data-testid={`hours-plus-${step}`}
          >
            +{step}
          </button>
        ))}
      </div>

      {machine.hours === null ? (
        <p className="shell__note">First reading for this machine.</p>
      ) : (
        <p className="shell__note">Last recorded: {machine.hours} h.</p>
      )}

      {tooLow ? (
        <p className="sheet__error" data-testid="hours-too-low">
          That hour reading is below the last one recorded ({machine.hours} h). Check the meter and
          try again.
        </p>
      ) : null}

      <div className="sheet__actions">
        <button type="button" className="sheet__button" onClick={onDone}>
          Cancel
        </button>
        <button
          type="button"
          className="sheet__button sheet__button--primary"
          onClick={() => void save()}
          disabled={saving || !valid || tooLow}
          data-testid="hours-save"
        >
          Log hours
        </button>
      </div>
    </section>
  );
}
