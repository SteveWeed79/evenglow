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
  incubationCreateSchema,
  maintenanceStoredSchema,
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
  /**
   * What this row is *about* — the group, the animal, the machine, the sack.
   *
   * **Plural, because a row can honestly be about two things.** A loss names
   * the group it came out of and, when somebody said which, the animal that
   * died; both timelines should show it, and picking one would mean a
   * per-animal history that silently omits the animal's own death.
   *
   * The ids a record *names*, and nothing inferred from them. A group's
   * timeline therefore does not sweep up its animals' weights — that is a walk
   * up a hierarchy, it is a different question, and the answer turned out to
   * be that **the caller makes the hop**: `HistoryScope` takes several
   * subjects, so a bed asks for itself and its plantings by name. The rule
   * here stays exactly as strict, and the decision is visible on the screen
   * that took it rather than inherited by every timeline in the app.
   *
   * Absent where a row is genuinely about nothing in particular: a predator
   * seen at the fence line is a fact about the farm.
   */
  subjects?: readonly string[];
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
 * `maintenanceStoredSchema` rather than `maintenanceCreateSchema.partial()`,
 * because the create schema carries refinements (an interval must be hours or
 * days, not neither) and zod will not make a refined object partial. It used to
 * be the update schema, which was the same object until updates learned to
 * carry a `null` meaning *cleared* — a value a stored row never holds.
 */
const storedService = maintenanceStoredSchema;

/** A set of eggs mid-flight: created, then candled, then hatched by update. */
const storedIncubation = incubationCreateSchema.partial();

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The ids a record names, with the absent ones dropped.
 *
 * Every builder calls this rather than assembling an array of its own, so
 * "which of these fields was set" is answered once. A record that names
 * nothing gets an empty list rather than `undefined`, because a row about the
 * farm at large and a row whose subject nobody filled in are the same thing to
 * a filter and should not be two shapes.
 */
function subjectsOf(...ids: readonly (string | undefined)[]): readonly string[] {
  return ids.filter((id): id is string => id !== undefined);
}

/**
 * The rows a scope wants, or all of them when it wants everything.
 *
 * A `Set` rather than repeated `includes`, because a bed with a season of
 * plantings passes a dozen ids and the whole history is walked once per row.
 */
function withinScope(
  events: readonly HistoryEvent[],
  subject: string | readonly string[] | undefined,
): HistoryEvent[] {
  if (subject === undefined) return [...events];

  const wanted = new Set(typeof subject === 'string' ? [subject] : subject);
  if (wanted.size === 0) return [];

  return events.filter((event) => event.subjects?.some((id) => wanted.has(id)) === true);
}

/** What a timeline is about. */
export interface HistoryScope {
  /**
   * Only rows naming this id — or any of these.
   *
   * The reusable detail screen is what this exists for: before it, `listHistory`
   * was farm-wide and `HistoryEvent` carried no subject at all, so nothing in
   * the app could answer *"what has happened to this animal"* and the screens
   * that wanted it filtered a single entity's records by hand.
   *
   * ## Several, because a hop is the caller's to make
   *
   * `subjects` on an event are the ids a record **names** and nothing inferred,
   * and that rule stays. But a bed's story genuinely is its plantings' —
   * a `harvest` names a *planting*, a planting names a bed, and *"we took four
   * kilos out of bed three in August"* is a true sentence about the bed. So the
   * hop is made **by the screen that means it**, which knows its own plantings,
   * rather than by a hierarchy walk buried in here that every timeline would
   * then inherit.
   *
   * That is what keeps a group's timeline free of its animals' weights: nobody
   * passes the animals. The day a screen wants that, it says so in one line and
   * the decision is visible where it was taken.
   */
  subject?: string | readonly string[] | undefined;
}

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

export async function listHistory(
  system: UnitSystem = 'metric',
  scope: HistoryScope = {},
): Promise<HistoryDay[]> {
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
        subjects: subjectsOf(v.flockId, v.birdId),
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
        subjects: subjectsOf(v.flockId, v.animalId),
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
        subjects: subjectsOf(v.flockId),
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
        // Both, and this is the row the plural exists for: a death belongs to
        // the group it came out of and to the animal, when somebody said which.
        subjects: subjectsOf(v.flockId, v.animalId),
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
              // What the chore was about, when it was hung on something.
              subjects: subjectsOf(v.subjectId),
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
              subjects: subjectsOf(v.equipmentId),
              title: `${v.title} — ${named(machineName, v.equipmentId, 'a machine')}`,
              ...(v.lastDoneAtHours === undefined
                ? { detail: 'Service done' }
                : { detail: `Service done at ${v.lastDoneAtHours} hours` }),
              tally: { key: 'jobs', amount: 1, unit: 'job' },
            },
      ),

      /**
       * A set of eggs, on the day it hatched.
       *
       * **A hatch was invisible in What happened**, which is a strange hole in
       * a poultry app: it is one of the few events on the year a keeper
       * remembers the date of, and the only place it appeared was the set's own
       * screen. Twelve eggs going in and eight chicks coming out is exactly the
       * shape of thing this projection is for.
       *
       * Mutable, like `task` and `maintenance` above and for the same reason —
       * the milestone is a field on the record rather than a log of its own,
       * because the record is the thing that runs for three weeks. `hatchedAt`
       * is the moment.
       *
       * **And unlike those two, deleting this row means what it says.** A
       * `maintenance` row is one service and archiving it takes the whole
       * recurring schedule; here the record and the event are the same thing —
       * one set of eggs, one hatch — so "take this back out" removes precisely
       * what the row describes.
       *
       * **The subject is the record itself**, which is the first time that
       * happens here. Everywhere else a subject is a foreign key, because the
       * event is a log naming something else; a hatch is a field on the very
       * record its screen is about. The source group comes too when the eggs
       * came from this farm — *"the hens' eggs hatched"* is true of the hens.
       *
       * Only the hatch, not the candling. Both are on the record and only one
       * of them is what happened *to* it: candling is a step in the middle of a
       * running set and the set's own screen states it, where a hatch is the
       * end of the story and belongs in the farm's.
       */
      eventsFrom('incubation', storedIncubation, (v, id) =>
        v.hatchedAt === undefined || v.label === undefined
          ? null
          : {
              id,
              entity: 'incubation',
              at: v.hatchedAt,
              subjects: subjectsOf(id, v.flockId),
              title: `${v.label} eggs hatched`,
              detail: [
                v.hatched === undefined ? null : plural(v.hatched, 'chick'),
                v.eggsSet === undefined ? null : `from ${plural(v.eggsSet, 'egg')} set`,
                v.earlyLosses === undefined || v.earlyLosses === 0
                  ? null
                  : `${v.earlyLosses} lost in the first days`,
              ]
                .filter((part): part is string => part !== null)
                .join(' · '),
            },
      ),

      eventsFrom('careLog', careLogCreateSchema, (v, id) => ({
        id,
        entity: 'careLog',
        at: v.occurredAt,
        subjects: subjectsOf(v.flockId, v.animalId),
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
        subjects: subjectsOf(v.flockId, v.animalId),
        title: `Weighed ${named(animalName, v.animalId, named(groupName, v.flockId, 'a group'))}`,
        detail: `${formatMass(v.massUg, system)}${v.sampled === true ? ' (a sample)' : ''}`,
      })),

      eventsFrom('shearing', shearingCreateSchema, (v, id) => ({
        id,
        entity: 'shearing',
        at: v.occurredAt,
        subjects: subjectsOf(v.flockId, v.animalId),
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
        subjects: subjectsOf(v.itemId),
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
        subjects: subjectsOf(v.equipmentId),
        title: `${named(machineName, v.equipmentId, 'A machine')} — ${v.hours} hours`,
      })),

      eventsFrom('harvest', harvestCreateSchema, (v, id) => ({
        id,
        entity: 'harvest',
        at: v.occurredAt,
        subjects: subjectsOf(v.plantingId),
        title: `Harvested ${named(plantingName, v.plantingId, 'a planting')}`,
        detail:
          v.massUg === undefined
            ? `${plural(v.count ?? 0, v.unit === 'bunch' ? 'bunch' : 'item', v.unit === 'bunch' ? 'bunches' : 'items')}`
            : formatMass(v.massUg, system),
      })),
    ])
  ).flat();

  /**
   * Filtered after the readers rather than inside them.
   *
   * Each reader knows one entity and nothing about scoping, and thirteen
   * filters would be thirteen chances for one to be forgotten — which would
   * show up as a timeline quietly missing a kind of event rather than as a
   * failure. The cost is reading the whole history to show part of it, which is
   * the same cost the farm-wide screen already pays and is a walk over records
   * already in memory.
   */
  const wanted = withinScope(all, scope.subject);

  return intoDays(wanted, system);
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
