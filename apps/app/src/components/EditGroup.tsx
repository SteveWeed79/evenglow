'use client';

import { useState } from 'react';
import { SPECIES_TRAITS } from '@steading/contracts';
import { describeLogFailure } from '../sync/failure';
import { useLog } from '../hooks/useSync';
import type { Group } from '../read/groups';

/**
 * Changes a group that already exists.
 *
 * Everything this needs was in place except the screen: `flockUpdateSchema` is
 * the create shape partialled, so `{name}` or `{count}` alone is a valid
 * mutation, and the server already applies updates and turns a delete into
 * `archivedAt` (P13 — archived, never removed).
 *
 * Head count is edited rather than derived. A flock changes for reasons the
 * app cannot see — six point-of-lay hens bought at market, four sold to a
 * neighbour, a recount after a fox — and deriving it from what happens to be
 * logged would quietly disagree with the birds in the run. Mortality is
 * recorded separately because it answers a different question: not how many
 * there are, but what happened.
 */
export function EditGroup({
  group,
  onDone,
}: {
  group: Group;
  onDone: () => void;
}): React.ReactElement {
  const log = useLog();
  const traits = SPECIES_TRAITS[group.species];

  const [name, setName] = useState(group.name);
  const [count, setCount] = useState(group.count);
  const [saving, setSaving] = useState(false);
  const [armed, setArmed] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const trimmed = name.trim();
  const changed = trimmed !== group.name || count !== group.count;

  async function save(): Promise<void> {
    if (saving || trimmed === '') return;
    setSaving(true);

    try {
      // Only what moved. A partial update keeps the mutation honest about
      // what the person actually did.
      await log({
        entity: 'flock',
        op: 'update',
        targetId: group.id,
        payload: {
          ...(trimmed === group.name ? {} : { name: trimmed }),
          ...(count === group.count ? {} : { count }),
        },
      });
    } catch (error) {
      setSaving(false);
      setFailure(describeLogFailure(error));
      return;
    }

    onDone();
  }

  async function archive(): Promise<void> {
    if (saving) return;

    /**
     * One deliberate tap, and no modal (R10).
     *
     * A group carries a season of egg counts and treatments behind it, and
     * there is no screen yet that lists archived groups — so in practice this
     * is a one-way door, and it should cost more than a mis-tap in a glove.
     */
    if (!armed) {
      setArmed(true);
      return;
    }

    setSaving(true);
    try {
      await log({ entity: 'flock', op: 'delete', targetId: group.id, payload: {} });
    } catch (error) {
      setSaving(false);
      setArmed(false);
      setFailure(describeLogFailure(error));
      return;
    }

    onDone();
  }

  return (
    <section className="addgroup">
      <p className="label">
        {traits.label} &middot; {traits.collective}
      </p>

      <label className="label" htmlFor="edit-group-name">
        Name this {traits.collective}
      </label>
      <input
        id="edit-group-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        data-testid="editgroup-name"
      />

      <p className="label">How many now?</p>
      <div className="addgroup__count">
        <button
          type="button"
          className="tally__step"
          onClick={() => setCount((c) => Math.max(0, c - 1))}
          aria-label="One fewer"
          disabled={count === 0}
        >
          &minus;
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

      {failure ? (
        <p className="log-error" role="alert">
          {failure}
        </p>
      ) : null}

      {armed ? (
        <p className="withdrawal" role="alert">
          Archiving keeps every record this {traits.collective} has, but takes it off your
          screens. Tap again to confirm.
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
          disabled={saving || !changed || trimmed === ''}
          data-testid="editgroup-save"
        >
          Save
        </button>
      </div>

      <button
        type="button"
        className="sheet__button"
        onClick={() => void archive()}
        disabled={saving}
        data-armed={armed ? '' : undefined}
        data-testid="editgroup-archive"
      >
        {armed ? 'Archive anyway' : `Archive this ${traits.collective}`}
      </button>
    </section>
  );
}
