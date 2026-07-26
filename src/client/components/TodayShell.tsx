'use client';

import { useCallback, useState } from 'react';
import { collectiveNoun, laysEggs } from '@/lib/contracts/entities';
import { useGroups } from '../hooks/useGroups';
import { useLog } from '../hooks/useSync';
import type { Group } from '../read/groups';
import { AddGroup } from './AddGroup';
import { ServiceWorker } from './ServiceWorker';
import { SyncChip } from './SyncChip';
import { Tally } from './Tally';

/**
 * Today. Chores and milestones are still to come; what is here is the log
 * path, which is the thing that has to be three taps from cold (R1).
 *
 * Reads entirely from the local projection, so it renders the same with the
 * radio off.
 */
export function TodayShell(): React.ReactElement {
  const { groups, eggs, loading } = useGroups();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <ServiceWorker />

      <header className="shell__status">
        <p className="label">
          {new Date().toLocaleDateString(undefined, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          })}
        </p>
        <SyncChip />
      </header>

      {adding ? (
        <AddGroup onDone={() => setAdding(false)} />
      ) : (
        <>
          {loading ? null : groups.length === 0 ? (
            <EmptyState onAdd={() => setAdding(true)} />
          ) : (
            groups.map((group) => (
              <GroupCard key={group.id} group={group} eggs={eggs.get(group.id) ?? 0} />
            ))
          )}

          {groups.length > 0 ? (
            <button type="button" className="sheet__button" onClick={() => setAdding(true)}>
              Add another group
            </button>
          ) : null}
        </>
      )}
    </>
  );
}

/** Empty screens invite (UX-SPEC §6). Warm here, because nothing depends on it. */
function EmptyState({ onAdd }: { onAdd: () => void }): React.ReactElement {
  return (
    <section className="arch shell__card">
      <p className="label">Nothing here yet</p>
      <p>Add what you keep and the day&rsquo;s logging comes with it.</p>
      <button
        type="button"
        className="sheet__button sheet__button--primary"
        onClick={onAdd}
        data-testid="add-first-group"
      >
        Add animals
      </button>
    </section>
  );
}

function GroupCard({ group, eggs }: { group: Group; eggs: number }): React.ReactElement {
  const log = useLog();

  const logEggs = useCallback(
    async (count: number) => {
      await log({
        entity: 'eggLog',
        op: 'create',
        payload: { occurredAt: Date.now(), flockId: group.id, count },
      });
    },
    [log, group.id],
  );

  const descriptor =
    group.species === 'other' && group.speciesOther
      ? group.speciesOther
      : collectiveNoun(group.species);

  return (
    <section className="group">
      <header className="group__head">
        <div>
          <p className="group__name">{group.name}</p>
          <p className="label">
            {group.count} head &middot; {descriptor}
          </p>
        </div>
        {eggs > 0 ? (
          <p className="group__today" data-numeric>
            {eggs}
          </p>
        ) : null}
      </header>

      {/* Offered per species — a goat keeper is not shown an egg counter. */}
      {laysEggs(group.species) ? (
        <Tally label={`Eggs from ${group.name}`} unit="eggs" onCommit={logEggs} />
      ) : null}
    </section>
  );
}
