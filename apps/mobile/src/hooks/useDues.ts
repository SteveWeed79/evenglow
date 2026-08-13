import { useCallback, useEffect, useState } from 'react';
import {
  birthDue,
  careDues,
  type Due,
  growOutWindow,
  feedOrderDue,
  gramsToUg,
  growingDues,
  incubationDues,
  layOnsetWindow,
  partsDue,
  poundsToUg,
  processingDue,
  serviceDue,
  shearingDues,
  taskDues,
  todayList,
  withdrawalDue,
} from '@steading/contracts';
import { listAnimals } from '@steading/core/read/animals';
import { listBreedings, listIncubations } from '@steading/core/read/breeding';
import { lastCareBySubject, listCareLogs } from '@steading/core/read/care';
import { currentFeedPlans, lastShornByGroup, listGroups } from '@steading/core/read/groups';
import { listBeds, listPlantings, listVarieties } from '@steading/core/read/growing';
import { listInventory, listMachines, listServices } from '@steading/core/read/iron';
import { listTasks } from '@steading/core/read/tasks';
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
      tasks,
      feedPlans,
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
      listTasks(),
      currentFeedPlans(),
    ]);

    const rows: Due[] = [];

    /** Names for the subjects a job can be pinned to. */
    const groupName = new Map(groups.map((group) => [group.id, group.name]));

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
    // A clip on a named animal counts for its group — a farm shears the whole
    // paddock in one afternoon and records whichever subject was to hand.
    const lastShorn = await lastShornByGroup(
      new Map(animals.map((animal) => [animal.id, animal.flockId])),
    );

    /**
     * What the shelf holds of each feed, in micrograms.
     *
     * **Only where the sack is counted by weight**, which is the same
     * condition `FeedScreen` uses before it will draw the shelf down. A farm
     * that keeps hay in bales gets no row rather than a date computed from an
     * invented idea of what a bale weighs. Summed by name, because two open
     * sacks of layers pellets is one supply.
     */
    const feedOnHandUg = new Map<string, number | null>();
    for (const item of inventory) {
      if (item.kind !== 'feed') continue;

      const ug =
        item.unit === 'lb'
          ? poundsToUg(item.quantity)
          : item.unit === 'kg'
            ? gramsToUg(item.quantity * 1000)
            : null;

      // Null is sticky: one bale-counted sack makes the total unknowable
      // rather than merely smaller, and a partial total would read as a
      // shortage that is not there.
      const seen = feedOnHandUg.get(item.name);
      feedOnHandUg.set(item.name, ug === null || seen === null ? null : (seen ?? 0) + ug);
    }

    for (const group of groups) {
      for (const active of withdrawals.get(group.id) ?? []) {
        rows.push(withdrawalDue(active, group.name));
      }

      /**
       * When the sack runs out — the row `feedPlan` exists to raise.
       *
       * Silent for a group with no ration, which is most groups on most
       * farms, and silent for a feed the shelf counts in bales.
       */
      const plan = feedPlans.get(group.id);
      if (plan !== undefined) {
        const order = feedOrderDue(
          group.id,
          group.name,
          plan.perAnimalPerDayUg,
          group.count,
          { feedName: plan.feedName, onHandUg: feedOnHandUg.get(plan.feedName) ?? null },
          now,
        );
        if (order) rows.push(order);
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
            /**
             * The farm's own intervals, and when it added the group.
             *
             * Both existed in the engine and neither was passed. `intervals`
             * is how a job is silenced or re-timed, so without it the only way
             * to quiet a row was to log a job that never happened; `since` is
             * what keeps a farm's first morning from being a wall of overdue
             * work. A builder with no caller is a feature that exists only in
             * the test suite — the same lesson this hook already records.
             */
            intervals: group.careIntervals,
            since: group.since,
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

      /**
       * The clip. Silent unless the group is kept for fibre AND its breed
       * carries an interval — a hair sheep sheds its own coat and must never
       * be asked about, which is why the library leaves that one blank.
       */
      rows.push(
        ...shearingDues(
          {
            id: group.id,
            name: group.name,
            species: group.species,
            breedId: group.breedId,
            purposes: group.purposes,
            lastShornAt: lastShorn.get(group.id),
            since: group.since,
          },
          now,
        ),
      );
    }

    // ── birthing and hatching ────────────────────────────────────────────────

    const animalNames = new Map(animals.map((a) => [a.id, a.name]));
    // The dam's group as well as her name — see `birthDue` for why the row
    // could not be opened without it.
    const animalGroups = new Map(animals.map((a) => [a.id, a.flockId]));
    for (const breeding of breedings) {
      const due = birthDue(
        breeding,
        animalNames.get(breeding.damId) ?? 'One of yours',
        animalGroups.get(breeding.damId),
      );
      if (due) rows.push(due);
    }

    for (const incubation of incubations) {
      rows.push(...incubationDues(incubation, incubation.label));
    }

    // ── growing ──────────────────────────────────────────────────────────────

    const bedNames = new Map(beds.map((b) => [b.id, b.name]));
    const varietyById = new Map(varieties.map((v) => [v.id, v]));

    for (const planting of plantings) {
      const variety = varietyById.get(planting.varietyId);
      rows.push(
        ...growingDues(planting, {
          // Named rather than two ULIDs — and named honestly when the variety
          // record has not reached this device yet.
          variety: variety?.name ?? 'this planting',
          bed: bedNames.get(planting.bedId) ?? 'the bed',
          // Lets the harvest row count from the day it went in the ground
          // rather than from a spring forecast. Absent is handled there.
          daysToMaturity: variety?.daysToMaturity,
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

    /**
     * The chores the farm wrote down itself — the one authored kind.
     *
     * Last, because everything above is derived from a record and these are
     * not. A task with no date produces no row at all; it lives on the Jobs
     * screen and never nags. See `taskDues`.
     */
    for (const task of tasks) {
      rows.push(...taskDues(task, groupName.get(task.subjectId ?? '')));
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
