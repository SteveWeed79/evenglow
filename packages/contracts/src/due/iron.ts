import { DEFAULT_NOTICE_DAYS } from './notice';
import { type Due, projectReading } from './types';

/**
 * Iron dues — services by hour meter or by date, and seasonal storage.
 *
 * The reason this and `growing.ts` are the same shape despite describing a
 * tractor and a lettuce: the morning list does not sort itself by module. A
 * farmer reads one list, so the two halves of the app produce rows that sort
 * against each other, and an hours-based service has to land in the same
 * ordering as a sow date. `projectedAt` is what makes that possible.
 */

export interface MachineRecord {
  id: string;
  name: string;
  hasHourMeter: boolean;
  /** Latest reading, or null if none has been taken. */
  hours: number | null;
  /**
   * Estimated hours per day, from the spread of readings. Null until there
   * are two — a rate from one reading is a line through a single point.
   */
  usagePerDay: number | null;
}

export interface ServiceInterval {
  id: string;
  name: string;
  /** Every N hours. Exactly one of this and `everyDays` is set. */
  everyHours?: number | undefined;
  everyDays?: number | undefined;
  /** Meter reading at the last time this service was done. */
  lastDoneAtHours?: number | undefined;
  lastDoneAt?: number | undefined;
}

const DAY_MS = 86_400_000;

/**
 * The next due row for one service interval on one machine.
 *
 * Returns null rather than a row whenever the interval cannot be evaluated —
 * an hours interval on a machine with no meter, or a machine with no reading
 * yet. A row nothing can clear is worse than a missing row: it sits on Today
 * forever and teaches people to scroll past the list.
 */
export function serviceDue(
  machine: MachineRecord,
  interval: ServiceInterval,
  now: number,
  noticeDays = DEFAULT_NOTICE_DAYS.service,
): Due | null {
  const subject = { entity: 'equipment' as const, id: machine.id };
  const key = `${machine.id}:service:${interval.id}`;
  const title = `${interval.name} on ${machine.name}`;

  if (interval.everyHours !== undefined) {
    if (!machine.hasHourMeter || machine.hours === null) return null;

    /**
     * Counted from the last service, or from zero if it has never been done.
     *
     * From zero rather than from the current reading, deliberately: a machine
     * bought at 900 hours with a 250-hour interval and no service history is
     * overdue, and the honest answer is to say so rather than to quietly
     * restart the clock and call it due at 1150.
     */
    const target = (interval.lastDoneAtHours ?? 0) + interval.everyHours;

    return {
      key,
      kind: 'service',
      subject,
      title,
      at: null,
      atReading: target,
      projectedAt: projectReading(machine.hours, machine.usagePerDay, target, now),
      noticeDays,
    };
  }

  if (interval.everyDays !== undefined) {
    // No history means it is due now, not in a year's time. An unserviced
    // machine is not a freshly serviced one.
    const from = interval.lastDoneAt ?? now - interval.everyDays * DAY_MS;

    return {
      key,
      kind: 'service',
      subject,
      title,
      at: from + interval.everyDays * DAY_MS,
      atReading: null,
      projectedAt: null,
      noticeDays,
    };
  }

  return null;
}

/**
 * Seasonal put-away — winterising, fuel stabiliser, blades off, stored dry.
 *
 * Anchored to a recurring calendar day rather than to an interval, because it
 * is a date on the year and not a period since anything. Two weeks' notice by
 * default: long enough to buy stabiliser, short enough not to sit there
 * through October.
 */
/**
 * **Not called by anything, and that is a missing feature rather than a missing
 * line.** `useDues` wires in every other builder this package ships; this one
 * takes `dueAt` and `lastDoneAt` as parameters and the equipment entity carries
 * neither — no field for when a machine should be put away for the season, and
 * no record of its having been done.
 *
 * Kept rather than deleted (invariant 13). Giving it a data source is a product
 * decision about whether the app should ask a farm to date the winterising of
 * each machine, and the arithmetic here is ready for the day it does.
 */
export function storageDue(
  machine: MachineRecord,
  dueAt: number,
  lastDoneAt: number | undefined,
  now: number,
  noticeDays = DEFAULT_NOTICE_DAYS.storage,
): Due | null {
  // Done since this date came round: nothing to show.
  if (lastDoneAt !== undefined && lastDoneAt >= dueAt) return null;
  // Deliberately still produced when overdue — see urgencyOf. A mower left out
  // through November is exactly the row that must not disappear quietly.
  void now;

  return {
    key: `${machine.id}:storage:${dueAt}`,
    kind: 'storage',
    subject: { entity: 'equipment', id: machine.id },
    title: `Put ${machine.name} away for the season`,
    at: dueAt,
    atReading: null,
    projectedAt: null,
    noticeDays,
  };
}
