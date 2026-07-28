'use client';

import { useCallback } from 'react';
import { laysEggs, longestWithdrawal, type ActiveWithdrawal } from '@steading/contracts';
import { useGroups } from '../hooks/useGroups';
import { useLog } from '../hooks/useSync';
import type { Group } from '../read/groups';
import { basketConfirmation } from '../voice';
import { BasketSpot } from './Marks';
import { Tally } from './Tally';
import { WithdrawalBanner } from './WithdrawalBanner';

/**
 * Today — the log path, and nothing that competes with it (R1, R2).
 *
 * Reads entirely from the local projection, so it renders the same with the
 * radio off. Defining groups and recording treatments live under Stock; what
 * is here is what a person does at 6am with a bucket in one hand.
 */
export function TodayShell(): React.ReactElement {
  const { groups, eggs, withdrawals, loading } = useGroups();

  if (loading) return <></>;

  const layers = groups.filter((g) => laysEggs(g.species));

  if (layers.length === 0) {
    return (
      <section className="panel shell__card">
        {/* Empty screens invite (UX-SPEC §6). */}
        <span className="spot"><BasketSpot /></span>
        <p className="label">Nothing to log yet</p>
        <p>Add what you keep under Stock, and the morning&rsquo;s tally lands here.</p>
      </section>
    );
  }

  return (
    <>
      {layers.map((group) => (
        <GroupTally
          key={group.id}
          group={group}
          eggs={eggs.get(group.id) ?? 0}
          withdrawal={longestWithdrawal(withdrawals.get(group.id) ?? [])}
        />
      ))}
    </>
  );
}

function GroupTally({
  group,
  eggs,
  withdrawal,
}: {
  group: Group;
  eggs: number;
  withdrawal: ActiveWithdrawal | null;
}): React.ReactElement {
  const log = useLog();

  const logEggs = useCallback(
    async (count: number, acknowledged: boolean) => {
      await log({
        entity: 'eggLog',
        op: 'create',
        payload: {
          occurredAt: Date.now(),
          flockId: group.id,
          count,
          // Recorded, not merely displayed: an acknowledged withdrawal is the
          // audit trail for a decision someone made deliberately.
          ...(acknowledged ? { withdrawalAcknowledged: true } : {}),
        },
      });
    },
    [log, group.id],
  );

  return (
    <section className="group">
      <header className="group__head">
        <div>
          <p className="group__name">{group.name}</p>
          <p className="label">{group.count} head</p>
        </div>
        {/* A bare number opposite the group's name could be anything — head
            count, eggs, hours. It says what it is. */}
        {eggs > 0 ? (
          <div className="group__today">
            <p className="group__todaycount" data-numeric>
              {eggs}
            </p>
            <span className="label">Eggs today</span>
          </div>
        ) : null}
      </header>

      {/* Informs, does not interrupt (R10). */}
      {withdrawal ? <WithdrawalBanner withdrawal={withdrawal} /> : null}

      <Tally
        label={`Eggs from ${group.name}`}
        unit="eggs"
        requireConfirm={withdrawal !== null}
        confirm={basketConfirmation}
        onCommit={logEggs}
      />
    </section>
  );
}
