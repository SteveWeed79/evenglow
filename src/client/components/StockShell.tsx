'use client';

import { useState } from 'react';
import { collectiveNoun, SPECIES_TRAITS } from '@/lib/contracts/entities';
import { useGroups } from '../hooks/useGroups';
import type { Group } from '../read/groups';
import { AddGroup } from './AddGroup';
import { RecordTreatment } from './RecordTreatment';

/**
 * Stock — groups and their management.
 *
 * Named Stock rather than Birds: smallholdings are mixed, and a goat keeper
 * should not have to look for their herd under a bird tab. Today owns the log
 * path; this owns everything that defines what is being logged.
 */
export function StockShell(): React.ReactElement {
  const { groups, loading } = useGroups();
  const [adding, setAdding] = useState(false);
  const [treating, setTreating] = useState<Group | null>(null);

  if (adding) return <AddGroup onDone={() => setAdding(false)} />;

  if (treating) {
    return (
      <RecordTreatment
        flockId={treating.id}
        species={treating.species}
        groupName={treating.name}
        onDone={() => setTreating(null)}
      />
    );
  }

  if (loading) return <></>;

  if (groups.length === 0) {
    return (
      <section className="arch shell__card">
        <p className="label">Nothing here yet</p>
        <p>Add what you keep and the day&rsquo;s logging comes with it.</p>
        <button
          type="button"
          className="sheet__button sheet__button--primary"
          onClick={() => setAdding(true)}
          data-testid="add-first-group"
        >
          Add animals
        </button>
      </section>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <section key={group.id} className="group">
          <header className="group__head">
            <div>
              <p className="group__name">{group.name}</p>
              <p className="label">
                {group.count} head &middot;{' '}
                {group.species === 'other' && group.speciesOther
                  ? group.speciesOther
                  : `${SPECIES_TRAITS[group.species].label.toLowerCase()}, ${collectiveNoun(group.species)}`}
              </p>
            </div>
          </header>

          <button
            type="button"
            className="sheet__button"
            onClick={() => setTreating(group)}
            data-testid={`record-treatment-${group.id}`}
          >
            Record a treatment
          </button>
        </section>
      ))}

      <button type="button" className="sheet__button" onClick={() => setAdding(true)}>
        Add another group
      </button>
    </>
  );
}
