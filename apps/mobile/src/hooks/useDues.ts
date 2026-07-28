import { useCallback, useEffect, useState } from 'react';
import {
  careDues,
  type Due,
  growOutWindow,
  layOnsetWindow,
  processingDue,
  todayList,
  withdrawalDue,
} from '@steading/contracts';
import { listGroups } from '@steading/core/read/groups';
import { withdrawalsBySubject } from '@steading/core/read/withdrawals';
import { subscribe } from '@steading/core/sync/engine';

/**
 * Today's list, composed from the local projection.
 *
 * This is where the due engine finally reaches a person. Every row is derived
 * on the device from records it already holds — no notification server, no
 * cloud scheduler, and it recomputes with the radio off.
 *
 * Recomputed on every engine publish rather than on a timer. The engine
 * publishes after every enqueue, so a treatment recorded in a barn moves the
 * withdrawal row immediately; and `now` is captured per pass, so a row that
 * crosses its date while the app sits open moves on the next publish rather
 * than at midnight tomorrow.
 */

export interface DuesView {
  dues: Due[];
  loading: boolean;
}

export function useDues(): DuesView {
  const [view, setView] = useState<DuesView>({ dues: [], loading: true });

  const refresh = useCallback(async () => {
    const now = Date.now();
    const groups = await listGroups();

    const rows: Due[] = [];

    /**
     * Withdrawals first, and by group, because the arithmetic is already
     * written and tested (W2). Re-deriving it here would give the banner on a
     * group and the row on Today two chances to disagree about whether eggs
     * are safe to sell.
     */
    const withdrawals = await withdrawalsBySubject(
      'egg',
      groups.map((g) => g.id),
    );
    for (const group of groups) {
      for (const active of withdrawals.get(group.id) ?? []) {
        rows.push(withdrawalDue(active, group.name));
      }

      /**
       * Husbandry. `lastDone` is empty until careLog is being written, which
       * means every interval reads as never-done and therefore due now —
       * correct, and deliberately loud: a farm that has never recorded
       * trimming either is not trimming or is not recording it.
       */
      rows.push(
        ...careDues({ id: group.id, name: group.name, species: group.species, lastDone: {} }, now),
      );

      // The grow-out clock. Silent unless the group says it is kept for meat
      // and carries a birth date and a breed the library knows.
      const processing = processingDue({
        id: group.id,
        name: group.name,
        ...(group.bornAt === undefined ? {} : { bornAt: group.bornAt }),
        ...(group.breedId === undefined ? {} : { breedId: group.breedId }),
        ...(group.purposes === undefined ? {} : { purposes: group.purposes }),
      });
      if (processing) rows.push(processing);
    }

    setView({ dues: todayList(rows, now), loading: false });
  }, []);

  // subscribe() publishes immediately, so the subscription performs the first
  // read — no separate initial fetch to keep in step with it.
  useEffect(() => subscribe(() => void refresh()), [refresh]);

  return view;
}

export { growOutWindow, layOnsetWindow };
