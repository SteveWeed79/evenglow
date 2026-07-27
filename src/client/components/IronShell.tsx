'use client';

import { useCallback, useEffect, useState } from 'react';
import { AddMachine } from './AddMachine';
import { LogHours } from './LogHours';
import { listMachines, type Machine } from '@steading/app/read/iron';
import { subscribe } from '@steading/app/sync/engine';

/**
 * Iron — the other half of W3.
 *
 * Deliberately the same shape as the stock screens: a list, a primary log
 * action per item, and a secondary add. The morning list does not sort itself
 * by module, so the two halves of the app should not feel like two apps.
 */
export function IronShell(): React.ReactElement {
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [logging, setLogging] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setMachines(await listMachines());
  }, []);

  useEffect(() => subscribe(() => void refresh()), [refresh]);

  if (adding) return <AddMachine onDone={() => setAdding(false)} />;

  const target = machines?.find((m) => m.id === logging);
  if (target) return <LogHours machine={target} onDone={() => setLogging(null)} />;

  if (machines === null) return <></>;

  if (machines.length === 0) {
    return (
      <section className="arch shell__card">
        <p className="label">No equipment yet</p>
        {/* Empty screens invite (UX-SPEC §6). */}
        <p>Add your tractor and its service schedule comes with it.</p>
        <button
          type="button"
          className="sheet__button sheet__button--primary"
          onClick={() => setAdding(true)}
          data-testid="add-first-machine"
        >
          Add a machine
        </button>
      </section>
    );
  }

  return (
    <>
      {machines.map((machine) => (
        <MachineCard key={machine.id} machine={machine} onLogHours={() => setLogging(machine.id)} />
      ))}

      <button type="button" className="sheet__button" onClick={() => setAdding(true)}>
        Add another machine
      </button>
    </>
  );
}

function MachineCard({
  machine,
  onLogHours,
}: {
  machine: Machine;
  onLogHours: () => void;
}): React.ReactElement {
  const description = [machine.make, machine.model].filter(Boolean).join(' ');

  return (
    <section className="group">
      <header className="group__head">
        <div>
          <p className="group__name">{machine.name}</p>
          {description ? <p className="label">{description}</p> : null}
        </div>
        {machine.hours !== null ? (
          <p className="group__today" data-numeric>
            {machine.hours} h
          </p>
        ) : null}
      </header>

      {/* W5 — the number that lets a filter be ordered before it matters. */}
      {machine.usagePerDay !== null ? (
        <p className="label" data-testid={`usage-${machine.id}`}>
          About {machine.usagePerDay.toFixed(1)} h/day
        </p>
      ) : null}

      {machine.hasHourMeter ? (
        <button
          type="button"
          className="tally__commit"
          onClick={onLogHours}
          data-testid={`log-hours-${machine.id}`}
        >
          Log hours
        </button>
      ) : (
        <p className="shell__note">No hour meter — services run off dates.</p>
      )}
    </section>
  );
}
