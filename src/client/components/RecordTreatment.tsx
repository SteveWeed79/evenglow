'use client';

import { useState } from 'react';
import {
  givesMilk,
  laysEggs,
  MEDICATION_ROUTES,
  type Species,
  type WithdrawalKind,
} from '@/lib/contracts/entities';
import { newId } from '@/lib/ulid';
import { useLog } from '../hooks/useSync';

/**
 * Records a treatment and its withdrawal periods (W2).
 *
 * The withdrawal numbers are the point of the screen. They come off the bottle
 * or the vet's note, so they are asked for plainly and default to zero rather
 * than to a guess — inventing a withdrawal period would be worse than having
 * none, because it would be trusted.
 */

const DAY_STEPS = [1, 7] as const;

function todayValue(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Local midnight for a yyyy-mm-dd value, so a date means the day the user meant. */
function dateToMs(value: string): number {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return Date.now();
  return new Date(y, m - 1, d).getTime();
}

export function RecordTreatment({
  flockId,
  species,
  groupName,
  onDone,
}: {
  flockId: string;
  species: Species;
  groupName: string;
  onDone: () => void;
}): React.ReactElement {
  const log = useLog();

  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [route, setRoute] = useState<(typeof MEDICATION_ROUTES)[number]>('water');
  const [dose, setDose] = useState('');
  const [administered, setAdministered] = useState(todayValue());
  const [ends, setEnds] = useState(todayValue());
  const [days, setDays] = useState<Record<WithdrawalKind, number>>({ egg: 0, meat: 0, milk: 0 });
  const [saving, setSaving] = useState(false);

  // Only ask about produce this species actually gives. Meat always applies.
  const kinds: WithdrawalKind[] = [
    ...(laysEggs(species) ? (['egg'] as const) : []),
    ...(givesMilk(species) ? (['milk'] as const) : []),
    'meat',
  ];

  function bump(kind: WithdrawalKind, by: number): void {
    setDays((current) => ({ ...current, [kind]: Math.max(0, (current[kind] ?? 0) + by) }));
  }

  async function save(): Promise<void> {
    if (saving || name.trim().length === 0) return;
    setSaving(true);

    // Only send the kinds that carry a withdrawal. An explicit zero and an
    // absent entry mean the same thing to the arithmetic, and omitting keeps
    // the record honest about what was actually specified.
    const withdrawalDays = Object.fromEntries(
      kinds.filter((kind) => days[kind] > 0).map((kind) => [kind, days[kind]]),
    );

    await log({
      entity: 'medication',
      op: 'create',
      targetId: newId(),
      payload: {
        flockId,
        name: name.trim(),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        route,
        ...(dose.trim() ? { dose: dose.trim() } : {}),
        administeredAt: dateToMs(administered),
        treatmentEndsAt: dateToMs(ends),
        ...(Object.keys(withdrawalDays).length > 0 ? { withdrawalDays } : {}),
      },
    });

    onDone();
  }

  return (
    <section className="addgroup">
      <p className="label">Treatment for {groupName}</p>

      <label className="label" htmlFor="med-name">
        Medication
      </label>
      <input
        id="med-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Amprolium"
        data-testid="med-name"
      />

      <label className="label" htmlFor="med-reason">
        What for (optional)
      </label>
      <input
        id="med-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Coccidiosis"
      />

      <p className="label">How given</p>
      <div className="addgroup__chips">
        {MEDICATION_ROUTES.map((r) => (
          <button
            key={r}
            type="button"
            className="addgroup__chip"
            aria-pressed={route === r}
            onClick={() => setRoute(r)}
          >
            {r === 'water' ? 'In water' : r === 'feed' ? 'In feed' : r}
          </button>
        ))}
      </div>

      <label className="label" htmlFor="med-dose">
        Dose (optional)
      </label>
      <input
        id="med-dose"
        value={dose}
        onChange={(e) => setDose(e.target.value)}
        placeholder="1 tsp per gallon"
      />

      <label className="label" htmlFor="med-start">
        First day
      </label>
      <input
        id="med-start"
        type="date"
        value={administered}
        onChange={(e) => setAdministered(e.target.value)}
      />

      <label className="label" htmlFor="med-end">
        Last day
      </label>
      <input id="med-end" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />

      <p className="label">Withdrawal — counted from the last day</p>
      {kinds.map((kind) => (
        <div key={kind} className="addgroup__count">
          <span className="withdrawal__kind">
            {kind === 'egg' ? 'Eggs' : kind === 'milk' ? 'Milk' : 'Meat'}
          </span>
          <button
            type="button"
            className="tally__step"
            onClick={() => bump(kind, -1)}
            aria-label={`One fewer day for ${kind}`}
            disabled={days[kind] === 0}
          >
            −
          </button>
          <output className="addgroup__number" data-numeric aria-live="polite">
            {days[kind]}
          </output>
          {DAY_STEPS.map((step) => (
            <button
              key={step}
              type="button"
              className="tally__step"
              onClick={() => bump(kind, step)}
              data-testid={`withdrawal-${kind}-plus-${step}`}
            >
              +{step}
            </button>
          ))}
        </div>
      ))}

      <p className="shell__note">
        Zero days means no withhold for that produce. Take the numbers from the label.
      </p>

      <div className="sheet__actions">
        <button type="button" className="sheet__button" onClick={onDone}>
          Cancel
        </button>
        <button
          type="button"
          className="sheet__button sheet__button--primary"
          onClick={() => void save()}
          disabled={saving || name.trim().length === 0}
          data-testid="med-save"
        >
          Record treatment
        </button>
      </div>
    </section>
  );
}
