import { useCallback, useEffect, useState } from 'react';
import type { ActiveWithdrawal } from '@homefarm/contracts';
import {
  eggsToday,
  type Group,
  listGroups,
  type Produce,
  produceToday,
} from '@homefarm/core/read/groups';
import { allWithdrawalsBySubject } from '@homefarm/core/read/withdrawals';
import { subscribe } from '@homefarm/core/sync/engine';
import { clearTrouble, reportTrouble } from './useTrouble';

export interface GroupsView {
  groups: Group[];
  eggs: Map<string, number>;
  /** Non-egg produce taken today, keyed `${groupId}:${kind}` (W2). */
  produce: Map<string, Produce>;
  /**
   * Every open withdrawal per group, of every kind (W2).
   *
   * Each entry carries its `kind`, so a screen picks the ones that hold the
   * produce it is about — `withdrawalsFor` does that — rather than treating
   * the list as "eggs", which is what it used to be.
   */
  withdrawals: Map<string, ActiveWithdrawal[]>;
  loading: boolean;
}

/**
 * Local-first group list.
 *
 * Re-reads whenever the sync engine publishes, which it does after every
 * enqueue — so a group added offline appears without waiting for anything.
 *
 * ## Every withdrawal kind, and this is the third time it has had to be said
 *
 * This asked for `'egg'` and nothing else. `useDues` had exactly that bug and
 * `AUDIT-2026-08` H11 records the fix there — *"a dairy goat's milk
 * withdrawal produces no Today row; meat holds appear nowhere"* — but the two
 * other readers of withdrawals were left as they were. So Today drew a milk
 * tally with the **egg** withdrawals beside it: a goat herd on a milk hold got
 * no banner and no second press, while a wound spray with an egg period on it
 * would have gated the milking. The group screen's band was egg-only too, so
 * `TreatmentScreen`'s promise — *"you will see a band on this group"* — was
 * kept for hens and broken for everything that is milked or eaten.
 *
 * `activeWithdrawals` only returns a kind the treatment recorded days for, so
 * asking for all three costs nothing on a flock of layers and needs no species
 * gate — and `allWithdrawalsBySubject` reads the treatments once for the lot.
 * `CLAUDE.md` names the poultry-only assumption as the one to hunt for, and a
 * withdrawal is the one place it is a regulatory event rather than a wrong
 * word.
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
    const withdrawals = await allWithdrawalsBySubject(groups.map((g) => g.id));

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
