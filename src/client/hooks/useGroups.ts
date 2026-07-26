'use client';

import { useCallback, useEffect, useState } from 'react';
import { eggsToday, type Group, listGroups } from '../read/groups';
import { subscribe } from '../sync/engine';

export interface GroupsView {
  groups: Group[];
  eggs: Map<string, number>;
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
    loading: true,
  });

  const refresh = useCallback(async () => {
    const [groups, eggs] = await Promise.all([listGroups(), eggsToday()]);
    setView({ groups, eggs, loading: false });
  }, []);

  // subscribe() publishes immediately, so the subscription itself performs
  // the first read — no separate initial fetch to keep in step with it.
  useEffect(() => subscribe(() => void refresh()), [refresh]);

  return view;
}
