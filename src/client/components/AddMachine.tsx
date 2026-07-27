'use client';

import { useState } from 'react';
import { describeLogFailure } from '@steading/app/sync/failure';
import { newId } from '@steading/contracts';
import { useLog } from '../hooks/useSync';

/**
 * Adds a machine.
 *
 * `hasHourMeter` is asked plainly because it changes what the app can do:
 * a tractor's service intervals come off engine hours, while a pump or an
 * auger has no meter and can only be scheduled by date. Guessing wrong means
 * either a reminder that never fires or a field that can never be filled.
 */
export function AddMachine({ onDone }: { onDone: () => void }): React.ReactElement {
  const log = useLog();
  const [name, setName] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [hasHourMeter, setHasHourMeter] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function save(): Promise<void> {
    if (saving || name.trim().length === 0) return;
    setSaving(true);

    try {
      await log({
        entity: 'equipment',
        op: 'create',
        targetId: newId(),
        payload: {
          name: name.trim(),
          ...(make.trim() ? { make: make.trim() } : {}),
          ...(model.trim() ? { model: model.trim() } : {}),
          hasHourMeter,
        },
      });
    } catch (error) {
      // `saving` must come back down. The guard at the top of save()
      // reads it, so leaving it true on a throw makes the button
      // permanently dead until the sheet is closed and reopened, with
      // the typed-in work still on screen and nothing said.
      setSaving(false);
      setFailure(describeLogFailure(error));
      return;
    }

    onDone();
  }

  return (
    <section className="addgroup">
      <p className="label">Add a machine</p>

      <label className="label" htmlFor="machine-name">
        What is it
      </label>
      <input
        id="machine-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="The loader"
        data-testid="machine-name"
      />

      <label className="label" htmlFor="machine-make">
        Make (optional)
      </label>
      <input
        id="machine-make"
        value={make}
        onChange={(e) => setMake(e.target.value)}
        placeholder="Kubota"
      />

      <label className="label" htmlFor="machine-model">
        Model (optional)
      </label>
      <input
        id="machine-model"
        value={model}
        onChange={(e) => setModel(e.target.value)}
        placeholder="B7800"
      />

      <p className="label">Does it have an hour meter?</p>
      <div className="addgroup__chips">
        <button
          type="button"
          className="addgroup__chip"
          aria-pressed={hasHourMeter}
          onClick={() => setHasHourMeter(true)}
        >
          Yes
        </button>
        <button
          type="button"
          className="addgroup__chip"
          aria-pressed={!hasHourMeter}
          onClick={() => setHasHourMeter(false)}
          data-testid="machine-no-meter"
        >
          No
        </button>
      </div>
      <p className="shell__note">
        {hasHourMeter
          ? 'Service intervals can run off engine hours.'
          : 'Service intervals will run off dates only.'}
      </p>

      {failure ? (
        <p className="log-error" role="alert">
          {failure}
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
          disabled={saving || name.trim().length === 0}
          data-testid="machine-save"
        >
          Add machine
        </button>
      </div>
    </section>
  );
}
