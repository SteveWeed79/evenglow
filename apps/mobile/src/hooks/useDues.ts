import { useCallback, useEffect, useState } from 'react';
import {
  birthDue,
  careDues,
  type Due,
  growOutWindow,
  growingDues,
  incubationDues,
  layOnsetWindow,
  partsDue,
  processingDue,
  serviceDue,
  todayList,
  withdrawalDue,
} from '@steading/contracts';
import { listAnimals } from '@steading/core/read/animals';
import { listBreedings, listIncubations } from '@steading/core/read/breeding';
import { lastCareBySubject, listCareLogs } from '@steading/core/read/care';
import { listGroups } from '@steading/core/read/groups';
import { listBeds, listPlantings, listVarieties } from '@steading/core/read/growing';
import { listInventory, listMachines, listServices } from '@steading/core/read/iron';
import { withdrawalsBySubject } from '@steading/core/read/withdrawals';
import { subscribe } from '@steading/core/sync/engine';
import { clearTrouble, reportTrouble } from './useTrouble';

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
 *
 * **Every builder the contracts package ships is wired in here.** They were
 * written and tested long before anything could write the records they read,
 * and a builder with no reader is a feature that exists only in the test
 * suite — the version of this hook that fed it groups and nothing else put
 * seven permanent husbandry rows on Today and produced no birth, hatch, sow
 * or service row at all.
 */

export interface DuesView {
  dues: Due[];
  loading: boolean;
}

export function useDues(): DuesView {
  const [view, setView] = useState<DuesView>({ dues: [], loading: true });

  const refresh = useCallback(async () => {
    const now = Date.now();

    const [
      groups,
      animals,
      careLogs,
      breedings,
      incubations,
      beds,
      plantings,
      varieties,
      machines,
      services,
      inventory,
    ] = await Promise.all([
      listGroups(),
      listAnimals(),
      listCareLogs(),
      listBreedings(),
      listIncubations(),
      listBeds(),
      listPlantings(),
      listVarieties(),
      listMachines(),
      listServices(),
      listInventory(),
    ]);

    const rows: Due[] = [];

    // ── stock ────────────────────────────────────────────────────────────────

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
    const lastCare = lastCareBySubject(careLogs);

    for (const group of groups) {
      for (const active of withdrawals.get(group.id) ?? []) {
        rows.push(withdrawalDue(active, group.name));
      }

      /**
       * Husbandry, against what was actually recorded.
       *
       * `lastDone` comes from `careLog` now. A job never done is still due
       * immediately and that is deliberate — a farm that has never recorded
       * trimming either is not trimming or is not recording it — but logging
       * it once clears the row for an interval, which is what makes the list
       * worth reading again tomorrow.
       */
      rows.push(
        ...careDues(
          {
            id: group.id,
            name: group.name,
            species: group.species,
            lastDone: lastCare.get(group.id) ?? {},
          },
          now,
        ),
      );

      // The grow-out clock. Silent unless the group says it is kept for meat
      // and carries a birth date and a breed the library knows.
      const processing = processingDue({
        id: group.id,
        name: group.name,
        ...(group.bornAt === undefined ? {} : { bornAt: group.bornAt }),
        ...(group.breedId === undefined ? {} : { breedId: group.breedId }),
        ...(group.purposes === undefined ? {} : { purposes: group.purposes }),
        ...(group.processAtWeeks === undefined
          ? {}
          : { processAtWeeks: group.processAtWeeks }),
      });
      if (processing) rows.push(processing);
    }

    // ── birthing and hatching ────────────────────────────────────────────────

    const animalNames = new Map(animals.map((a) => [a.id, a.name]));
    for (const breeding of breedings) {
      const due = birthDue(breeding, animalNames.get(breeding.damId) ?? 'One of yours');
      if (due) rows.push(due);
    }

    for (const incubation of incubations) {
      rows.push(...incubationDues(incubation, incubation.label));
    }

    // ── growing ──────────────────────────────────────────────────────────────

    const bedNames = new Map(beds.map((b) => [b.id, b.name]));
    const varietyNames = new Map(varieties.map((v) => [v.id, v.name]));

    for (const planting of plantings) {
      rows.push(
        ...growingDues(planting, {
          // Named rather than two ULIDs — and named honestly when the variety
          // record has not reached this device yet.
          variety: varietyNames.get(planting.varietyId) ?? 'this planting',
          bed: bedNames.get(planting.bedId) ?? 'the bed',
        }),
      );
    }

    // ── iron ─────────────────────────────────────────────────────────────────

    const partsById = new Map(inventory.map((item) => [item.id, item]));

    for (const machine of machines) {
      for (const service of services) {
        if (service.equipmentId !== machine.id) continue;

        const due = serviceDue(
          machine,
          {
            id: service.id,
            name: service.title,
            ...(service.intervalHours === undefined ? {} : { everyHours: service.intervalHours }),
            ...(service.intervalDays === undefined ? {} : { everyDays: service.intervalDays }),
            ...(service.lastDoneAtHours === undefined
              ? {}
              : { lastDoneAtHours: service.lastDoneAtHours }),
            ...(service.lastDoneAtDate === undefined ? {} : { lastDoneAt: service.lastDoneAtDate }),
          },
          now,
        );
        if (!due) continue;

        rows.push(due);

        /**
         * And separately, whether the part is on the shelf.
         *
         * Its own row rather than a flag on the service, because the two are
         * discharged differently: "order the filter" is done by ordering, and
         * "change the filter" is done by changing it.
         */
        const parts = (service.partIds ?? [])
          .flatMap((id) => {
            const item = partsById.get(id);
            return item === undefined ? [] : [{ id: item.id, name: item.name, quantity: item.quantity }];
          });

        const order = partsDue(due, parts);
        if (order) rows.push(order);
      }
    }

    setView({ dues: todayList(rows, now), loading: false });
    clearTrouble();
  }, []);

  // subscribe() publishes immediately, so the subscription performs the first
  // read — no separate initial fetch to keep in step with it.
  useEffect(
    () => subscribe(() => void refresh().catch((error: unknown) => reportTrouble("today's list", error))),
    [refresh],
  );

  return view;
}

export { growOutWindow, layOnsetWindow };
