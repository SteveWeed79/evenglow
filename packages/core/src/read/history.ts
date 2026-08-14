import { z } from 'zod';
import {
  CARE_KIND_LABELS,
  careLogCreateSchema,
  eggLogCreateSchema,
  type Entity,
  feedLogCreateSchema,
  formatMass,
  formatVolume,
  gramsToUg,
  harvestCreateSchema,
  hourReadingCreateSchema,
  maintenanceUpdateSchema,
  mlToUl,
  mortalityCreateSchema,
  predatorCreateSchema,
  productionLogCreateSchema,
  shearingCreateSchema,
  stockAdjustmentCreateSchema,
  taskCreateSchema,
  type StockReason,
  type UnitSystem,
  weightCreateSchema,
} from '@steading/contracts';
import { localStore } from '../db/store';
import { listAnimals } from './animals';
import { listGroups } from './groups';
import { listPlantings, listVarieties } from './growing';
import { listInventory, listMachines } from './iron';

/**
 * What happened, in the order it happened.
 *
 * ## Why this is a read and not a table
 *
 * Everything here is already on the device — the same append-only records the
 * tallies and the due engine work from. There is no `history` entity and there
 * must not be one: a second copy of what happened is a second thing that can
 * disagree with the first, and this codebase has that rule written down in
 * three other places (`Due` is derived, completion flags are refused, the
 * forecast is a cache).
 *
 * So this is a projection over the ten append-only entities, and it is exactly
 * as true as the records are.
 *
 * ## Append-only, and only append-only
 *
 * `eggLog`, `productionLog`, `feedLog`, `mortality`, `predator`, `hourReading`,
 * `harvest`, `weight`, `shearing`, `careLog`, `stockAdjustment`. These are the entities that
 * describe an event at a moment — they all carry `occurredAt`, they cannot be
 * edited, and they cannot conflict.
 *
 * The mutable ones are deliberately absent. A flock is not something that
 * happened; it is something that is. Renaming a group is not a farm event, and
 * a history that filled up with "you changed the head count" would bury the
 * morning somebody actually lost four birds.
 *
 * ## Ordered by `occurredAt`, which is the farm's clock
 *
 * Not `clientTs` — invariant 4 says never trust that — and not `serverTs`,
 * which is when it synced rather than when it happened. `occurredAt` is what
 * the person said, and backdating a feed you forgot to log is an ordinary
 * thing to do. A history sorted by arrival would put it at the top under
 * today's date and be wrong about the only thing it is for.
 */

/** One thing that happened. */
export interface HistoryEvent {
  /**
   * The record's own id, stable across recomputations.
   *
   * It is the `targetId` of the record behind the row, which is what makes
   * taking one back possible from here: the screen enqueues a `delete` against
   * this id and the entity beside it, with nothing else to look up.
   */
  id: string;
  /** Typed, not a loose string — the screen enqueues a mutation against it. */
  entity: Entity;
  /** When the farm says it happened. */
  at: number;
  /** One line, already in the farm's words. */
  title: string;
  /** The rest, wanted only once a day has been opened. */
  detail?: string;
  /**
   * What this contributes to the day's readout, if anything.
   *
   * A day summarises as "12 eggs · 2 feeds", and that is built from these
   * rather than by re-reading the events: a tally and a count are different
   * things ("12 eggs" adds up, "2 feeds" counts occurrences), and deciding
   * which is which belongs with the event that knows.
   */
  tally?: { key: string; amount: number; unit: string };
}

export interface HistoryDay {
  /** Midnight local, the key and the heading. */
  day: number;
  /** Newest first within the day. */
  events: HistoryEvent[];
  /** "12 eggs · 2 feeds · 1 loss" — what the day reads as when closed. */
  summary: string;
}

/** Local midnight. Days are what a person remembers in, not UTC. */
function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Reads one entity, parsing each row and dropping what will not parse.
 *
 * Dropping rather than throwing: a single unreadable row — a record written by
 * a newer build, a payload half-migrated — must not blank the whole history.
 * The alternative is one bad row costing a farm every other row it has.
 */
async function eventsFrom<T>(
  entity: Entity,
  schema: z.ZodType<T>,
  build: (value: T, id: string) => HistoryEvent | null,
): Promise<HistoryEvent[]> {
  const records = await localStore().readRecordsByEntity(entity);

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = schema.safeParse(record.value);
      if (!parsed.success) return [];
      const event = build(parsed.data, record.targetId);
      return event === null ? [] : [event];
    });
}

/**
 * The stored task, loosened.
 *
 * A projection holds whatever the payload held, and a task is built by a
 * `create` and then changed by `update`s — so a row mid-flight can be missing
 * fields the create schema requires. Partial here, and the two fields this
 * read actually needs are checked below.
 */
const storedTask = taskCreateSchema.partial();

/**
 * A service schedule as the projection holds it — create and updates merged,
 * so every field is optional from a reader's point of view.
 *
 * The update schema rather than `maintenanceCreateSchema.partial()`, because
 * the create schema carries refinements (an interval must be hours or days,
 * not neither) and zod will not make a refined object partial. The update
 * schema is that same shape already made optional, which is exactly what a
 * merged row is.
 */
const storedService = maintenanceUpdateSchema;

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Everything that happened, newest day first.
 *
 * `system` decides whether a weight reads in kilos or pounds — the farm's own
 * setting, carried on the site.
 */
/** What each reason is called in a history row, as a sentence's first word. */
const STOCK_WORDS: Record<StockReason, string> = {
  bought: 'Bought',
  used: 'Used',
  lost: 'Lost',
  spoiled: 'Spoiled',
  miscounted: 'Recounted',
  other: 'Adjusted',
};

export async function listHistory(system: UnitSystem = 'metric'): Promise<HistoryDay[]> {
  const [groups, animals, machines, plantings, varieties, stock] = await Promise.all([
    listGroups(),
    listAnimals(),
    listMachines(),
    listPlantings(),
    listVarieties(),
    listInventory(),
  ]);

  /** Names, so a row reads "The hens" rather than an id nobody can pronounce. */
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const animalName = new Map(animals.map((a) => [a.id, a.name]));
  const machineName = new Map(machines.map((m) => [m.id, m.name]));
  const itemName = new Map(stock.map((i) => [i.id, i.name]));
  const varietyOf = new Map(varieties.map((v) => [v.id, v.name]));
  const plantingName = new Map(
    plantings.map((p) => [p.id, varietyOf.get(p.varietyId) ?? 'a planting']),
  );

  /**
   * An archived group still has records, and they are still history.
   *
   * Invariant 13 in the read layer: hiding a group must not silently rewrite
   * what happened while it was here. A name that cannot be resolved says so
   * plainly rather than rendering a blank.
   */
  const named = (
    map: Map<string, string>,
    id: string | undefined,
    fallback: string,
  ): string => (id === undefined ? fallback : (map.get(id) ?? fallback));

  const all = (
    await Promise.all([
      eventsFrom('eggLog', eggLogCreateSchema, (v, id) => ({
        id,
        entity: 'eggLog',
        at: v.occurredAt,
        title: `${plural(v.count, 'egg')} — ${named(groupName, v.flockId ?? v.birdId, 'a group')}`,
        tally: { key: 'eggs', amount: v.count, unit: 'egg' },
        ...(v.withdrawalAcknowledged === true
          ? { detail: 'Logged through an open withdrawal, deliberately.' }
          : {}),
      })),

      eventsFrom('productionLog', productionLogCreateSchema, (v, id) => ({
        id,
        entity: 'productionLog',
        at: v.occurredAt,
        title: `${v.amount} ${v.unit} ${v.label ?? v.kind} — ${named(
          groupName,
          v.flockId,
          named(animalName, v.animalId, 'a group'),
        )}`,
        tally: { key: v.kind, amount: v.amount, unit: v.unit },
      })),

      eventsFrom('feedLog', feedLogCreateSchema, (v, id) => ({
        id,
        entity: 'feedLog',
        at: v.occurredAt,
        title: `Fed ${named(groupName, v.flockId, 'a group')}`,
        detail: `${formatMass(gramsToUg(v.amountGrams), system)}${
          v.feedType === undefined ? '' : ` · ${v.feedType}`
        }`,
        tally: { key: 'feeds', amount: 1, unit: 'feed' },
      })),

      eventsFrom('mortality', mortalityCreateSchema, (v, id) => ({
        id,
        entity: 'mortality',
        at: v.occurredAt,
        title: `Lost ${v.count} — ${named(groupName, v.flockId, 'a group')}`,
        detail: `Cause: ${v.cause}`,
        tally: { key: 'losses', amount: v.count, unit: 'loss', },
      })),

      eventsFrom('predator', predatorCreateSchema, (v, id) => ({
        id,
        entity: 'predator',
        at: v.occurredAt,
        title: `${v.species} seen`,
        detail: [
          v.location === undefined ? null : `Near ${v.location}`,
          v.lossCount > 0 ? `${plural(v.lossCount, 'animal')} lost` : 'Nothing lost',
        ]
          .filter((part): part is string => part !== null)
          .join(' · '),
      })),

      /**
       * A job the farm wrote down, on the day it was ticked off.
       *
       * **The one mutable entity in here, and it needs saying why.** Everything
       * else is append-only: a record exists, it happened, it is dated. A task
       * is a row that gets edited, and `completedAt` is the moment — the one
       * place in this app where a completion flag is the truth rather than a
       * second copy of it, because fixing a gate produces nothing else to log.
       *
       * So a finished job lands in What happened, which is what lets the Jobs
       * screen let go of it overnight instead of accumulating a graveyard.
       *
       * **What this cannot do, stated:** a recurring job overwrites its own
       * `completedAt` each time, so history shows the LAST time it was done
       * rather than every time. A one-off — which is what most written-down
       * jobs are — is exact. Recording every occurrence would want an
       * append-only completion record, which is a bigger change than the
       * problem currently justifies.
       */
      eventsFrom('task', storedTask, (v, id) =>
        v.completedAt === undefined || v.title === undefined
          ? null
          : {
              id,
              entity: 'task',
              at: v.completedAt,
              title: v.title,
              detail: 'Job done',
              tally: { key: 'jobs', amount: 1, unit: 'job' },
            },
      ),

      /**
       * A service, on the day it was marked done.
       *
       * Reported as *"it doesn't log to history"*, and it did not: an oil
       * change is one of the few things on a farm that has a receipt, a cost
       * and a next-time, and What happened had no idea it had occurred.
       *
       * Mutable, like `task` above and for the same reason — a completion is a
       * field on the schedule rather than a record of its own, because the
       * schedule is the thing that recurs. `lastDoneAtDate` is the moment.
       *
       * **What this cannot do, stated:** the field is overwritten every time,
       * so history shows the LAST service on each schedule and not the ones
       * before it. That is the same limitation `task` carries and it costs
       * more here, because a machine's service record is exactly the kind of
       * thing somebody wants three years of. Fixing it properly wants an
       * append-only completion record — the shape `careLog` already is for
       * animals — which is a schema change rather than a reader change, so it
       * is named here rather than half-done.
       *
       * The hours are the detail, because on an hours-based schedule they are
       * the whole fact: the date says when somebody was under the machine, the
       * reading says what the next interval counts from.
       */
      eventsFrom('maintenance', storedService, (v, id) =>
        v.lastDoneAtDate === undefined || v.title === undefined
          ? null
          : {
              id,
              entity: 'maintenance',
              at: v.lastDoneAtDate,
              title: `${v.title} — ${named(machineName, v.equipmentId, 'a machine')}`,
              ...(v.lastDoneAtHours === undefined
                ? { detail: 'Service done' }
                : { detail: `Service done at ${v.lastDoneAtHours} hours` }),
              tally: { key: 'jobs', amount: 1, unit: 'job' },
            },
      ),

      eventsFrom('careLog', careLogCreateSchema, (v, id) => ({
        id,
        entity: 'careLog',
        at: v.occurredAt,
        title: `${CARE_KIND_LABELS[v.kind] ?? v.kind} — ${named(
          groupName,
          v.flockId,
          named(animalName, v.animalId, 'a group'),
        )}`,
        ...(v.product === undefined ? {} : { detail: v.product }),
        tally: { key: 'jobs', amount: 1, unit: 'job' },
      })),

      eventsFrom('weight', weightCreateSchema, (v, id) => ({
        id,
        entity: 'weight',
        at: v.occurredAt,
        title: `Weighed ${named(animalName, v.animalId, named(groupName, v.flockId, 'a group'))}`,
        detail: `${formatMass(v.massUg, system)}${v.sampled === true ? ' (a sample)' : ''}`,
      })),

      eventsFrom('shearing', shearingCreateSchema, (v, id) => ({
        id,
        entity: 'shearing',
        at: v.occurredAt,
        title: `Shorn — ${named(
          groupName,
          v.flockId,
          named(animalName, v.animalId, 'a group'),
        )}`,
        detail: `${formatMass(v.massUg, system)}${
          v.animalsShorn === undefined ? '' : ` from ${plural(v.animalsShorn, 'animal')}`
        }`,
      })),

      eventsFrom('stockAdjustment', stockAdjustmentCreateSchema, (v, id) => ({
        id,
        entity: 'stockAdjustment',
        at: v.occurredAt,
        /**
         * The reason leads, because the reason is the whole point of the row.
         * A shelf quantity could always be changed; what it could not do was
         * say whether four bags were fed out or eaten by something.
         */
        title: `${STOCK_WORDS[v.reason]} ${Math.abs(v.delta)} — ${named(
          itemName,
          v.itemId,
          'something on the shelf',
        )}`,
        ...(v.note === undefined ? {} : { detail: v.note }),
      })),

      eventsFrom('hourReading', hourReadingCreateSchema, (v, id) => ({
        id,
        entity: 'hourReading',
        at: v.occurredAt,
        title: `${named(machineName, v.equipmentId, 'A machine')} — ${v.hours} hours`,
      })),

      eventsFrom('harvest', harvestCreateSchema, (v, id) => ({
        id,
        entity: 'harvest',
        at: v.occurredAt,
        title: `Harvested ${named(plantingName, v.plantingId, 'a planting')}`,
        detail:
          v.massUg === undefined
            ? `${plural(v.count ?? 0, v.unit === 'bunch' ? 'bunch' : 'item', v.unit === 'bunch' ? 'bunches' : 'items')}`
            : formatMass(v.massUg, system),
      })),
    ])
  ).flat();

  return intoDays(all, system);
}

/**
 * Groups events into days and writes each day's readout.
 *
 * Exported for the tests, which are about the summarising rather than about
 * the ten readers above.
 */
export function intoDays(
  events: readonly HistoryEvent[],
  system: UnitSystem = 'metric',
): HistoryDay[] {
  const byDay = new Map<number, HistoryEvent[]>();

  for (const event of events) {
    const day = startOfDay(event.at);
    const existing = byDay.get(day);
    if (existing === undefined) byDay.set(day, [event]);
    else existing.push(event);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => b - a)
    .map(([day, list]) => {
      // Newest first inside the day, and by id where two share a moment — a
      // list that reorders itself between renders looks, on a phone, exactly
      // like something changed.
      const ordered = [...list].sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1));
      return { day, events: ordered, summary: summarise(ordered, system) };
    });
}

export interface HistoryMonth {
  /** Local midnight on the first, which is the key and the heading. */
  month: number;
  /** Newest first, and every one of them already sorted inside itself. */
  days: HistoryDay[];
  /** "312 eggs · 14 feeds" — what the month reads as when it is closed. */
  summary: string;
  /** How many days in it had anything at all. */
  active: number;
}

/**
 * Days gathered into months.
 *
 * Reported as a question, and the right one: *"Should the What happened screen
 * collapse by month > day > stuff that happened?"*
 *
 * It should. A flat list of days grows without bound and there is no year at
 * which it stops — by a second season a farm scrolling for last April is
 * scrolling past three hundred headings, and the screen that holds everything
 * the farm knows becomes the one nobody opens.
 *
 * The screen had a cap of thirty days and a "show all" button underneath, which
 * is the shape of a problem rather than an answer to it: the fix for a list too
 * long to read is not a button that makes it longer.
 *
 * ## The month's line is built from the days, not re-read
 *
 * `summarise` already knows how to turn events into "12 eggs · 2 feeds", so a
 * month is the same function over a wider window. Re-implementing it here would
 * be two definitions of what a total means, and they would drift the first time
 * a tally unit changed.
 */
export function intoMonths(days: readonly HistoryDay[], system: UnitSystem = 'metric'): HistoryMonth[] {
  const byMonth = new Map<number, HistoryDay[]>();

  for (const day of days) {
    const date = new Date(day.day);
    const month = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
    const existing = byMonth.get(month);
    if (existing === undefined) byMonth.set(month, [day]);
    else existing.push(day);
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => b - a)
    .map(([month, list]) => {
      const ordered = [...list].sort((a, b) => b.day - a.day);
      return {
        month,
        days: ordered,
        summary: summarise(
          ordered.flatMap((day) => day.events),
          system,
        ),
        active: ordered.length,
      };
    });
}

/**
 * The one line a closed day shows.
 *
 * Insertion-ordered by the tally key's first appearance, so the same day
 * always reads the same way rather than reordering as records arrive.
 */
function summarise(events: readonly HistoryEvent[], system: UnitSystem): string {
  const totals = new Map<string, { amount: number; unit: string }>();

  for (const event of events) {
    if (event.tally === undefined) continue;
    const running = totals.get(event.tally.key);
    if (running === undefined) {
      totals.set(event.tally.key, { amount: event.tally.amount, unit: event.tally.unit });
    } else {
      running.amount += event.tally.amount;
    }
  }

  const parts = [...totals.values()].map(({ amount, unit }) => {
    // A stored measure is scaled into the farm's own system; a counted thing
    // ("egg", "bale") is a word and takes a plural instead.
    if (unit === 'ml') return formatVolume(mlToUl(amount), system);
    if (unit === 'g') return formatMass(gramsToUg(amount), system);
    return plural(amount, unit);
  });

  // A day whose events all decline to tally — a weighing, a sighting — still
  // happened, and saying how many beats saying nothing.
  if (parts.length === 0) return plural(events.length, 'record');
  return parts.join(' · ');
}
