'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ActiveWithdrawal } from '@/lib/withdrawal';
import { eggsToday, type Group, listGroups } from '../read/groups';
import { withdrawalsBySubject } from '../read/withdrawals';
import { subscribe } from '../sync/engine';

export interface GroupsView {
  groups: Group[];
  eggs: Map<string, number>;
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
    withdrawals: new Map(),
    loading: true,
  });

  const refresh = useCallback(async () => {
    const [groups, eggs] = await Promise.all([listGroups(), eggsToday()]);
    const withdrawals = await withdrawalsBySubject(
      'egg',
      groups.map((g) => g.id),
    );
    setView({ groups, eggs, withdrawals, loading: false });
  }, []);

  // subscribe() publishes immediately, so the subscription itself performs
  // the first read — no separate initial fetch to keep in step with it.
  useEffect(() => subscribe(() => void refresh()), [refresh]);

  return view;
}
