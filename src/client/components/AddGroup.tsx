'use client';

import { useState } from 'react';
import { SPECIES, SPECIES_TRAITS, type Species } from '@/lib/contracts/entities';
import { newId } from '@/lib/ulid';
import { useLog } from '../hooks/useSync';

/**
 * Adds a group of animals.
 *
 * Species chips rather than a select, grouped so a long list stays scannable
 * at arm's length (UX-SPEC §5). The count uses a stepper up to 99 and a field
 * beyond it, per R5 — a hundred quail is a real number and not worth 100 taps.
 */

const GROUPINGS = [
  { title: 'Poultry', group: 'poultry' as const },
  { title: 'Ratites', group: 'ratite' as const },
  { title: 'Ruminants', group: 'ruminant' as const },
  { title: 'Other stock', group: 'other' as const },
];

export function AddGroup({ onDone }: { onDone: () => void }): React.ReactElement {
  const log = useLog();
  const [species, setSpecies] = useState<Species>('chicken');
  const [name, setName] = useState('');
  const [count, setCount] = useState(0);
  const [other, setOther] = useState('');
  const [saving, setSaving] = useState(false);

  const traits = SPECIES_TRAITS[species];

  async function save(): Promise<void> {
    if (saving) return;
    setSaving(true);

    await log({
      entity: 'flock',
      op: 'create',
      targetId: newId(),
      payload: {
        name: name.trim() || traits.label,
        species,
        ...(species === 'other' && other.trim() ? { speciesOther: other.trim() } : {}),
        count,
      },
    });

    onDone();
  }

  return (
    <section className="addgroup">
      <p className="label">What do you keep?</p>

      {GROUPINGS.map(({ title, group }) => (
        <div key={group} className="addgroup__band">
          <p className="label addgroup__bandlabel">{title}</p>
          <div className="addgroup__chips">
            {SPECIES.filter((s) => SPECIES_TRAITS[s].group === group).map((s) => (
              <button
                key={s}
                type="button"
                className="addgroup__chip"
                aria-pressed={species === s}
                onClick={() => setSpecies(s)}
              >
                {SPECIES_TRAITS[s].label}
              </button>
            ))}
          </div>
        </div>
      ))}

      {species === 'other' ? (
        <>
          <label className="label" htmlFor="other-species">
            What are they?
          </label>
          <input
            id="other-species"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            placeholder="Yaks"
          />
        </>
      ) : null}

      <label className="label" htmlFor="group-name">
        Name this {traits.collective}
      </label>
      <input
        id="group-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={traits.label}
      />

      <p className="label">How many?</p>
      <div className="addgroup__count">
        <button
          type="button"
          className="tally__step"
          onClick={() => setCount((c) => Math.max(0, c - 1))}
          aria-label="One fewer"
          disabled={count === 0}
        >
          −
        </button>
        <output className="addgroup__number" data-numeric aria-live="polite">
          {count}
        </output>
        <button
          type="button"
          className="tally__step"
          onClick={() => setCount((c) => c + 1)}
          aria-label="One more"
        >
          +1
        </button>
        <button type="button" className="tally__step" onClick={() => setCount((c) => c + 10)}>
          +10
        </button>
      </div>

      <div className="sheet__actions">
        <button type="button" className="sheet__button" onClick={onDone}>
          Cancel
        </button>
        <button
          type="button"
          className="sheet__button sheet__button--primary"
          onClick={() => void save()}
          disabled={saving}
          data-testid="addgroup-save"
        >
          Add {traits.collective}
        </button>
      </div>
    </section>
  );
}
