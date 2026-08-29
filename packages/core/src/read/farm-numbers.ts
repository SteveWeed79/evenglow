import {
  eggLogCreateSchema,
  feedLogCreateSchema,
  gramsToUg,
  hourReadingCreateSchema,
  mortalityCreateSchema,
  productionLogCreateSchema,
  PRODUCE_KINDS,
  type Entity,
} from '@homefarm/contracts';
import type { z } from 'zod';
import { localStore } from '../db/store';
import { listGroups } from './groups';
import { listMachines, listServices } from './iron';
import { readNumbers, type SeasonNumbers } from './numbers';

/**
 * What the whole farm did this year, beside what it did last year.
 *
 * ## Why this exists next to `readNumbers` rather than inside it
 *
 * `readNumbers` answers about **crops** — what was picked, by crop and by bed —
 * and it is complete about them. What it is not is the farm. Reported plainly:
 * *"The Numbers on the farm screen should show ALL data, products, feed, crops
 * etc. not just plants."*
 *
 * That is right, and it is the row's own fault for being called what it is. A
 * screen reached from the Farm hub under the words "The numbers" promises the
 * farm, and a farm that keeps hens and a tractor opened it to find a page about
 * beds.
 *
 * So this reads every domain and `readNumbers` keeps its job as the crop half.
 * Nothing was taken away from it (invariant 13) — the crop screen still calls
 * it and still shows exactly what it showed.
 *
 * ## A year, not a season
 *
 * Everything here is a log with a moment on it, so it buckets by the year of
 * `occurredAt`, and `readNumbers` buckets its harvests the same way. One column
 * is "this year" across the whole farm and the other is the same period last
 * year, and every figure in both answers the same question about when.
 *
 * **This paragraph used to say something slightly different and it was wrong.**
 * It said `readNumbers` bucketed by `planting.season` and that "the two agree,
 * which is the point". They agreed only for a crop sown and picked inside one
 * year: a rhubarb crown stamped 2024 credited its 2026 picking to 2024, so this
 * screen's crop column answered a different question from every column beside
 * it. `readNumbers` now buckets picks by when they were picked; its *planting*
 * count still goes by `planting.season`, which is a different question with a
 * different right answer — a crown put in during 2024 went in in 2024 however
 * long it goes on cropping.
 *
 * ## Derived, never stored
 *
 * The same rule the due engine and `readNumbers` follow. A total kept beside an
 * append-only log is a total that will one day disagree with it.
 */

/** Exported from contracts as a const array; this is the member type. */
type ProduceKind = (typeof PRODUCE_KINDS)[number];

export interface ProduceTotal {
  kind: ProduceKind;
  /** What it is called when `kind` is 'other', or the kind's own word. */
  label: string;
  amount: number;
  /** 'ml' or 'g' — never mixed within a row, because the log does not mix them. */
  unit: string;
}

export interface AnimalNumbers {
  /** Head on the farm now. Not a per-year figure — a farm has what it has. */
  head: number;
  groups: number;
  eggs: number;
  produce: ProduceTotal[];
  /** Deaths recorded, whatever the cause. */
  losses: number;
  byCause: { cause: string; count: number }[];
}

export interface FeedNumbers {
  /** How many times feed was recorded, which is the shape of the year. */
  feeds: number;
  massUg: number;
}

export interface MachineHours {
  machineId: string;
  machine: string;
  hours: number;
}

export interface MachineNumbers {
  machines: number;
  /** Hours run across everything with a meter, this year. */
  hours: number;
  byMachine: MachineHours[];
  services: number;
}

export interface YearNumbers {
  year: number;
  crops: SeasonNumbers;
  animals: AnimalNumbers;
  feed: FeedNumbers;
  machines: MachineNumbers;
}

export interface FarmNumbers {
  now: YearNumbers;
  /**
   * The same period last year, or null on a farm's first.
   *
   * Null rather than an empty year, for the reason `readNumbers` gives: "nothing
   * last year" and "no last year" are different sentences and a screen says a
   * different thing for each.
   */
  before: YearNumbers | null;
}

const yearOf = (at: number): number => new Date(at).getFullYear();

/** Every row of one entity that parses, as its payload. */
async function valuesOf<T>(entity: Entity, schema: z.ZodType<T>): Promise<T[]> {
  const records = await localStore().readRecordsByEntity(entity);

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = schema.safeParse(record.value);
      return parsed.success ? [parsed.data] : [];
    });
}

const PRODUCE_WORDS: Record<ProduceKind, string> = {
  milk: 'Milk',
  fibre: 'Fibre',
  honey: 'Honey',
  other: 'Other',
};

/**
 * Hours run in a window, which is not the sum of the readings.
 *
 * `hourReading.hours` is a **meter face** — the cumulative total on the machine
 * — so adding them up would produce a number with no meaning at all, growing
 * faster the more often somebody writes one down.
 *
 * What ran in a year is the difference between where the meter finished and
 * where it started. The baseline is the last reading *before* the window when
 * there is one, so hours turned between January and the first reading of the
 * year are counted rather than quietly dropped; failing that it is the first
 * reading inside the window, which undercounts and says nothing false.
 *
 * A meter that went backwards — replaced, or written down wrong — contributes
 * nothing rather than a negative. Machines get swapped and the reading starts
 * again at zero, and no farm ran minus four hundred hours.
 */
function hoursIn(readings: readonly { occurredAt: number; hours: number }[], year: number): number {
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();

  const sorted = [...readings].sort((a, b) => a.occurredAt - b.occurredAt);
  const inside = sorted.filter((r) => r.occurredAt >= start && r.occurredAt < end);
  if (inside.length === 0) return 0;

  const beforeWindow = sorted.filter((r) => r.occurredAt < start);
  const baseline = beforeWindow[beforeWindow.length - 1] ?? inside[0];
  const last = inside[inside.length - 1];

  if (baseline === undefined || last === undefined) return 0;

  const run = last.hours - baseline.hours;
  return run > 0 ? run : 0;
}

/**
 * Everything, in one pass over the store.
 *
 * One read per entity rather than a query per figure: the whole point of the
 * local store is that this is cheap, and a screen making twenty reads would be
 * slower on a handset than the arithmetic it was avoiding.
 */
export async function readFarmNumbers(thisYear = new Date().getFullYear()): Promise<FarmNumbers> {
  const [crops, groups, machines, services, eggs, produce, feeds, losses, readings] =
    await Promise.all([
      readNumbers(thisYear),
      listGroups(),
      listMachines(),
      listServices(),
      valuesOf('eggLog', eggLogCreateSchema),
      valuesOf('productionLog', productionLogCreateSchema),
      valuesOf('feedLog', feedLogCreateSchema),
      valuesOf('mortality', mortalityCreateSchema),
      valuesOf('hourReading', hourReadingCreateSchema),
    ]);

  const machineName = new Map(machines.map((m) => [m.id, m.name]));

  const readingsByMachine = new Map<string, { occurredAt: number; hours: number }[]>();
  for (const reading of readings) {
    const list = readingsByMachine.get(reading.equipmentId) ?? [];
    list.push({ occurredAt: reading.occurredAt, hours: reading.hours });
    readingsByMachine.set(reading.equipmentId, list);
  }

  const assemble = (year: number): YearNumbers => {
    const inYear = <T extends { occurredAt: number }>(rows: readonly T[]): T[] =>
      rows.filter((row) => yearOf(row.occurredAt) === year);

    /**
     * Produce is grouped by kind AND unit, never summed across them.
     *
     * Millilitres of milk and grams of fibre are different quantities and
     * adding them would be arithmetic on a category error. 'other' is split by
     * its own label too, so honey water and lanolin do not become one number.
     */
    const produceRows = new Map<string, ProduceTotal>();
    for (const row of inYear(produce)) {
      const label: string =
        row.kind === 'other' ? (row.label ?? 'Other') : (PRODUCE_WORDS[row.kind] ?? 'Other');
      const key = `${row.kind}:${label}:${row.unit}`;
      const found: ProduceTotal =
        produceRows.get(key) ?? { kind: row.kind, label, amount: 0, unit: row.unit };
      found.amount += row.amount;
      produceRows.set(key, found);
    }

    const causes = new Map<string, number>();
    let lost = 0;
    for (const row of inYear(losses)) {
      lost += row.count;
      causes.set(row.cause, (causes.get(row.cause) ?? 0) + row.count);
    }

    const feedRows = inYear(feeds);

    const byMachine = [...readingsByMachine.entries()]
      .map(([machineId, rows]) => ({
        machineId,
        machine: machineName.get(machineId) ?? 'A machine',
        hours: hoursIn(rows, year),
      }))
      .filter((row) => row.hours > 0)
      .sort((a, b) => b.hours - a.hours);

    return {
      year,
      crops: year === thisYear ? crops.now : (crops.before ?? emptyCrops(year)),
      animals: {
        // Head and group counts describe the farm now, not the year — a farm
        // has what it has, and asking "how many hens in 2025" of a live flock
        // is a question the records cannot answer.
        head: groups.reduce((sum, group) => sum + group.count, 0),
        groups: groups.length,
        eggs: inYear(eggs).reduce((sum, row) => sum + row.count, 0),
        produce: [...produceRows.values()].sort((a, b) => b.amount - a.amount),
        losses: lost,
        byCause: [...causes.entries()]
          .map(([cause, count]) => ({ cause, count }))
          .sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause)),
      },
      feed: {
        feeds: feedRows.length,
        massUg: feedRows.reduce((sum, row) => sum + gramsToUg(row.amountGrams), 0),
      },
      machines: {
        machines: machines.length,
        hours: byMachine.reduce((sum, row) => sum + row.hours, 0),
        byMachine,
        /**
         * A `service` is a schedule rather than an event, so what is counted is
         * the ones last *done* inside the year. A plan that has never been
         * carried out has no date and counts nowhere, which is right: it is a
         * intention, not work done.
         */
        services: services.filter(
          (service) =>
            service.lastDoneAtDate !== undefined && yearOf(service.lastDoneAtDate) === year,
        ).length,
      },
    };
  };

  /**
   * Whether there was a last year at all, asked of every domain rather than of
   * crops alone.
   *
   * A farm that kept hens in its first year and planted nothing would otherwise
   * be told it had no previous year, on a screen showing a column of eggs from
   * it. `readNumbers` answers only for plantings, which is correct for the crop
   * screen and too narrow here.
   */
  const previous = thisYear - 1;
  const hadOne =
    crops.before !== null ||
    [...eggs, ...produce, ...feeds, ...losses, ...readings].some(
      (row) => yearOf(row.occurredAt) === previous,
    ) ||
    services.some(
      (service) =>
        service.lastDoneAtDate !== undefined && yearOf(service.lastDoneAtDate) === previous,
    );

  return { now: assemble(thisYear), before: hadOne ? assemble(previous) : null };
}

function emptyCrops(season: number): SeasonNumbers {
  return { season, massUg: 0, count: 0, picks: 0, plantings: 0, byCrop: [], byBed: [] };
}
