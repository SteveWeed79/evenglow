'use client';

import { useState } from 'react';
import { collectiveNoun, SPECIES_TRAITS } from '@steading/contracts';
import { useGroups } from '../hooks/useGroups';
import type { Group } from '../read/groups';
import { AddGroup } from './AddGroup';
import { EditGroup } from './EditGroup';
import { NestBoxSpot } from './Marks';
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
  const [editing, setEditing] = useState<Group | null>(null);

  if (adding) return <AddGroup onDone={() => setAdding(false)} />;

  if (editing) return <EditGroup group={editing} onDone={() => setEditing(null)} />;

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
        {/* Empty screens invite, and specific beats clever (UX-SPEC §6). */}
        <span className="spot"><NestBoxSpot /></span>
        <p className="label">Nothing here yet</p>
        <p>
          Add what you keep &mdash; a few hens, a pair of goats, the house cow &mdash; and the
          day&rsquo;s logging comes with it.
        </p>
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

          <div className="sheet__actions">
            <button
              type="button"
              className="sheet__button"
              onClick={() => setEditing(group)}
              data-testid={`edit-group-${group.id}`}
            >
              Edit
            </button>
            <button
              type="button"
              className="sheet__button"
              onClick={() => setTreating(group)}
              data-testid={`record-treatment-${group.id}`}
            >
              Record a treatment
            </button>
          </div>
        </section>
      ))}

      <button type="button" className="sheet__button" onClick={() => setAdding(true)}>
        Add another group
      </button>
    </>
  );
}
