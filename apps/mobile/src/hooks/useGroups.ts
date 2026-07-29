
import { useCallback, useEffect, useState } from 'react';
import type { ActiveWithdrawal } from '@steading/contracts';
import {
  eggsToday,
  type Group,
  listGroups,
  type Produce,
  produceToday,
} from '@steading/core/read/groups';
import { withdrawalsBySubject } from '@steading/core/read/withdrawals';
import { subscribe } from '@steading/core/sync/engine';
import { clearTrouble, reportTrouble } from './useTrouble';

export interface GroupsView {
  groups: Group[];
  eggs: Map<string, number>;
  /** Non-egg produce taken today, keyed `${groupId}:${kind}` (W2). */
  produce: Map<string, Produce>;
  /** Open egg withdrawals per group (W2). */
  withdrawals: Map<string, ActiveWithdrawal[]>;
  loading: boolean;
}

/**
 * Local-first group list.
 *
 * Re-reads whenever the sync engine publishes, which it does after every
 * enqueue — so a group added offline appears without waiting for anything.
 */
export function useGroups(): GroupsView {
  const [view, setView] = useState<GroupsView>({
    groups: [],
    eggs: new Map(),
    produce: new Map(),
    withdrawals: new Map(),
    loading: true,
  });

  const refresh = useCallback(async () => {
    const [groups, eggs, produce] = await Promise.all([
      listGroups(),
      eggsToday(),
      produceToday(),
    ]);
    const withdrawals = await withdrawalsBySubject(
      'egg',
      groups.map((g) => g.id),
    );
    setView({ groups, eggs, produce, withdrawals, loading: false });
    clearTrouble();
  }, []);

  // subscribe() publishes immediately, so the subscription itself performs
  // the first read — no separate initial fetch to keep in step with it.
  useEffect(
    () => subscribe(() => void refresh().catch((error: unknown) => reportTrouble('the stock list', error))),
    [refresh],
  );

  return view;
}
