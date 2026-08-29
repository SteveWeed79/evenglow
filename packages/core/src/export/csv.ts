/**
 * A farm's records, as something it can hand to somebody else.
 *
 * Parity floor P7 and P9, and the reason it leads the roadmap: the app could
 * show two years of records and had no way to give any of them to an
 * accountant, a vet, or somebody buying a tractor. A farm that cannot get its
 * data out is a farm that cannot leave, and every review of every competitor in
 * this category says so.
 *
 * ## Pure, and here rather than on the screen
 *
 * Nothing in this file touches the filesystem, the share sheet or a native
 * module. It turns records into strings. That is what makes the escaping —
 * which is the whole difficulty — testable in Node, and it is the same seam
 * that lets `read/history.ts` be trusted.
 *
 * ## Built from the same reads the screens use
 *
 * Not from a second pass over the store. An export that disagreed with What
 * happened would be worse than no export: the screen is what somebody checked
 * before they sent the file.
 */

import {
  CARE_KIND_LABELS,
  careLogCreateSchema,
  eggLogCreateSchema,
  feedLogCreateSchema,
  harvestCreateSchema,
  hourReadingCreateSchema,
  medicationCreateSchema,
  mortalityCreateSchema,
  predatorCreateSchema,
  productionLogCreateSchema,
  serviceCompletionCreateSchema,
  shearingCreateSchema,
  weightCreateSchema,
} from '@homefarm/contracts';
import { z } from 'zod';
import { localStore } from '../db/store';
import { listAnimals } from '../read/animals';
import { listGroups } from '../read/groups';
import { listMachines, listServices } from '../read/iron';

/** One file. */
export interface Sheet {
  /** Becomes the filename, so no spaces and nothing a filesystem dislikes. */
  name: string;
  csv: string;
  /** Data rows, not counting the header. Zero means the sheet is left out. */
  rows: number;
}

export interface ExportRange {
  /** Inclusive, in ms. Absent means from the beginning. */
  from?: number | undefined;
  /** Inclusive, in ms. Absent means up to now. */
  to?: number | undefined;
}

/**
 * Escapes one field for RFC 4180, and defuses it for a spreadsheet.
 *
 * Two separate jobs and both are necessary.
 *
 * **Quoting** is the standard: a field containing a comma, a quote or a
 * newline is wrapped in quotes with its own quotes doubled. A note reading
 * `Found her down, called the vet` breaks every row after it without this.
 *
 * **The formula guard** is the one people forget. Excel and Sheets treat a
 * leading `=`, `+`, `-`, `@`, tab or carriage return as the start of a
 * formula, so a group somebody named `=1+1` becomes a calculation, and a
 * hostile value becomes the CSV-injection attack that is on the OWASP list.
 * Prefixing an apostrophe is the documented fix: the spreadsheet shows the
 * original text and evaluates nothing.
 *
 * A farm's own note is not an attack, but a farm importing a supplier's list
 * and exporting it again is exactly how one arrives — and "our data only" is
 * the assumption every CSV-injection write-up starts by demolishing.
 */
export function field(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';

  const text = String(value);
  if (text === '') return '';

  const risky = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(risky) ? `"${risky.replaceAll('"', '""')}"` : risky;
}

/** One CSV, header first. */
export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [header.map((h) => field(h)).join(',')];
  for (const row of rows) {
    lines.push(row.map((cell) => field(cell as string | number | null | undefined)).join(','));
  }
  // CRLF, because RFC 4180 says so and because Excel on Windows is where these
  // land. Every reader accepts it; not every Windows reader accepts bare LF.
  return lines.join('\r\n');
}

/**
 * `YYYY-MM-DD HH:MM`, local.
 *
 * Not ISO with a Z: a farm reading its own export wants the morning it
 * actually collected the eggs, not the same moment in UTC. Both Excel and
 * Sheets parse this shape as a datetime without being asked.
 */
export function stamp(at: number): string {
  const date = new Date(at);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Whether a moment is inside the requested range. */
function within(at: number, range: ExportRange): boolean {
  if (range.from !== undefined && at < range.from) return false;
  if (range.to !== undefined && at > range.to) return false;
  return true;
}

/**
 * The two columns every sheet ends with, and why they are not optional.
 *
 * A name is what a person reads and it is not an identity: two groups called
 * *Big coop* export as the same word, a group renamed in March makes February's
 * rows look like a different flock, and an archived subject reads `(archived)`
 * for all of them at once. Every one of those is a question an accountant, a
 * vet or an inspector asks of a spreadsheet, and none of them can be answered
 * from the words alone.
 *
 * So the name stays first — it is what the sheet is for — and the ULID goes at
 * the end, where it is available to anyone who needs to group, join or trace a
 * row and out of the way of everybody else.
 *
 * **Two ids, because they answer different questions.** `Subject id` is what
 * the row is *about*; `Record id` is the row itself, which is what makes a
 * particular entry traceable back to the app, and to whatever it was that
 * looked wrong.
 */
const ID_COLUMNS = ['Subject id', 'Record id'] as const;

/** Reads one entity, parsing each row and dropping what will not parse. */
async function rowsFrom<T>(
  entity: string,
  schema: z.ZodType<T>,
  build: (value: T, id: string) => { at: number; cells: unknown[]; subject?: string | undefined } | null,
  range: ExportRange,
): Promise<unknown[][]> {
  const records = await localStore().readRecordsByEntity(entity);

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = schema.safeParse(record.value);
      if (!parsed.success) return [];
      const built = build(parsed.data, record.targetId);
      // A single unreadable row must not cost a farm the other nine hundred.
      if (built === null || !within(built.at, range)) return [];
      return [[...built.cells, built.subject ?? '', record.targetId]];
    })
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

/**
 * Every sheet a farm's records make, oldest row first.
 *
 * Empty sheets are dropped rather than exported as a lone header: a market
 * gardener does not want eleven files about animals they do not keep.
 */
export async function buildExport(range: ExportRange = {}): Promise<Sheet[]> {
  const [groups, animals, machines, services] = await Promise.all([
    listGroups(),
    listAnimals(),
    listMachines(),
    listServices(),
  ]);

  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const animalName = new Map(animals.map((a) => [a.id, a.name]));
  const machineName = new Map(machines.map((m) => [m.id, m.name]));

  /**
   * A name, or a plain marker when the subject is gone.
   *
   * An archived group still has records and they are still history
   * (invariant 13). Writing a blank would read as a bug in the export.
   */
  const named = (map: Map<string, string>, id: string | undefined): string =>
    id === undefined ? '' : (map.get(id) ?? '(archived)');

  const sheets: Sheet[] = [];
  const add = (name: string, header: readonly string[], rows: unknown[][]): void => {
    if (rows.length === 0) return;
    // The id columns are appended here rather than written into each header,
    // for the reason `rowsFrom` appends the values rather than each sheet
    // building them: every sheet is another chance to leave one out, and the
    // sheet that got left out would be the one somebody needed.
    //
    // Counted rather than numbered, because the number went stale. This said
    // "twelve sheets is twelve chances" and three other places said thirteen —
    // `backup.ts`, `ExportScreen.tsx` and `ROADMAP.md` — while there were
    // twelve. Adding `service-completions` has made those three right by
    // accident, which is not the same as their having been maintained.
    sheets.push({ name, csv: toCsv([...header, ...ID_COLUMNS], rows), rows: rows.length });
  };

  add(
    'eggs',
    ['When', 'Group', 'Eggs', 'Logged through a withdrawal'],
    await rowsFrom(
      'eggLog',
      eggLogCreateSchema,
      (v) => ({
        at: v.occurredAt,
        cells: [
          stamp(v.occurredAt),
          named(groupName, v.flockId ?? v.birdId),
          v.count,
          v.withdrawalAcknowledged === true ? 'yes' : '',
        ],
        subject: v.flockId ?? v.birdId,
      }),
      range,
    ),
  );

  add(
    'production',
    ['When', 'Group or animal', 'What', 'Amount', 'Unit', 'Logged through a withdrawal'],
    await rowsFrom(
      'productionLog',
      productionLogCreateSchema,
      (v) => ({
        at: v.occurredAt,
        cells: [
          stamp(v.occurredAt),
          v.flockId === undefined ? named(animalName, v.animalId) : named(groupName, v.flockId),
          v.label ?? v.kind,
          v.amount,
          v.unit,
          v.withdrawalAcknowledged === true ? 'yes' : '',
        ],
        subject: v.flockId ?? v.animalId,
      }),
      range,
    ),
  );

  add(
    'feed',
    ['When', 'Group', 'Grams', 'What'],
    await rowsFrom(
      'feedLog',
      feedLogCreateSchema,
      (v) => ({
        at: v.occurredAt,
        cells: [stamp(v.occurredAt), named(groupName, v.flockId), v.amountGrams, v.feedType ?? ''],
        subject: v.flockId,
      }),
      range,
    ),
  );

  add(
    'losses',
    ['When', 'Group', 'How many', 'Cause', 'Cull weight (g)'],
    await rowsFrom(
      'mortality',
      mortalityCreateSchema,
      (v) => ({
        at: v.occurredAt,
        cells: [
          stamp(v.occurredAt),
          named(groupName, v.flockId),
          v.count,
          v.cause,
          v.cullWeightGrams ?? '',
        ],
        subject: v.animalId ?? v.flockId,
      }),
      range,
    ),
  );

  add(
    'predators',
    ['When', 'What', 'Lost', 'Where'],
    await rowsFrom(
      'predator',
      predatorCreateSchema,
      (v) => ({
        at: v.occurredAt,
        cells: [stamp(v.occurredAt), v.species, v.lossCount, v.location ?? ''],
      }),
      range,
    ),
  );

  /**
   * The sheet a vet or an inspector asks for.
   *
   * `medication` is mutable rather than append-only, so this is its current
   * state rather than its history — which is what a withdrawal question needs
   * anyway: what was given, when, and when the produce cleared.
   */
  add(
    'treatments',
    [
      'Given',
      // "Group or animal", like its four siblings, because it is one — see the
      // cell below.
      'Group or animal',
      'Medication',
      'Treatment ends',
      'Egg withdrawal (days)',
      'Meat',
      'Milk',
    ],
    await rowsFrom(
      'medication',
      medicationCreateSchema,
      (v) => ({
        at: v.administeredAt,
        cells: [
          stamp(v.administeredAt),
          /**
           * Both, and it used to be `named(groupName, v.flockId)` alone.
           *
           * A treatment given to ONE animal — the ordinary case for a goat, a
           * ewe, a cow — has `animalId` and no `flockId`, so `named` was handed
           * `undefined` and returned the empty string. Every per-animal
           * treatment therefore exported with a **blank subject**, on the sheet
           * a vet or an inspector reads to see who was treated with what.
           *
           * The row's own `subject` said `v.flockId ?? v.animalId` two lines
           * below the whole time, and the four sibling sheets — eggs,
           * production, husbandry, weights — all fall back the same way.
           */
          v.flockId === undefined ? named(animalName, v.animalId) : named(groupName, v.flockId),
          v.name,
          v.treatmentEndsAt === undefined ? '' : stamp(v.treatmentEndsAt),
          v.withdrawalDays?.egg ?? '',
          v.withdrawalDays?.meat ?? '',
          v.withdrawalDays?.milk ?? '',
        ],
        subject: v.flockId ?? v.animalId,
      }),
      range,
    ),
  );

  add(
    'husbandry',
    ['When', 'Group or animal', 'Job', 'Product', 'How many'],
    await rowsFrom(
      'careLog',
      careLogCreateSchema,
      (v) => ({
        at: v.occurredAt,
        cells: [
          stamp(v.occurredAt),
          v.flockId === undefined ? named(animalName, v.animalId) : named(groupName, v.flockId),
          CARE_KIND_LABELS[v.kind] ?? v.kind,
          v.product ?? '',
          v.animalsTreated ?? '',
        ],
        subject: v.flockId ?? v.animalId,
      }),
      range,
    ),
  );

  add(
    'weights',
    ['When', 'Group or animal', 'Micrograms', 'A sample'],
    await rowsFrom(
      'weight',
      weightCreateSchema,
      (v) => ({
        at: v.occurredAt,
        cells: [
          stamp(v.occurredAt),
          v.flockId === undefined ? named(animalName, v.animalId) : named(groupName, v.flockId),
          v.massUg,
          v.sampled === true ? 'yes' : '',
        ],
        subject: v.flockId ?? v.animalId,
      }),
      range,
    ),
  );

  add(
    'shearing',
    ['When', 'Group or animal', 'Micrograms', 'Animals shorn'],
    await rowsFrom(
      'shearing',
      shearingCreateSchema,
      (v) => ({
        at: v.occurredAt,
        cells: [
          stamp(v.occurredAt),
          v.flockId === undefined ? named(animalName, v.animalId) : named(groupName, v.flockId),
          v.massUg,
          v.animalsShorn ?? '',
        ],
        subject: v.flockId ?? v.animalId,
      }),
      range,
    ),
  );

  add(
    'harvests',
    ['When', 'Planting', 'Unit', 'Micrograms', 'Count'],
    await rowsFrom(
      'harvest',
      harvestCreateSchema,
      (v) => ({
        at: v.occurredAt,
        cells: [stamp(v.occurredAt), v.plantingId, v.unit, v.massUg ?? '', v.count ?? ''],
        subject: v.plantingId,
      }),
      range,
    ),
  );

  /**
   * The two machine sheets, which are P7 on their own: the history somebody
   * hands over with the tractor.
   */
  add(
    'machine-hours',
    ['When', 'Machine', 'Hours'],
    await rowsFrom(
      'hourReading',
      hourReadingCreateSchema,
      (v) => ({
        at: v.occurredAt,
        cells: [stamp(v.occurredAt), named(machineName, v.equipmentId), v.hours],
        subject: v.equipmentId,
      }),
      range,
    ),
  );

  /**
   * ── The schedule, read the way the screens read it ────────────────────────
   *
   * **This read `maintenance.lastDoneAtDate` straight out of the store, and
   * nothing writes that field any more.** A service is discharged by a
   * `serviceCompletion` event; `ServiceDoneScreen` writes one and never touches
   * the schedule. `read/iron.ts` and `read/history.ts` were both moved over.
   * This was not, so:
   *
   * - export *everything* → `Last done` and `At hours` blank on every row,
   *   however many services the farm had recorded;
   * - export *the last year* → `at` was the epoch for every row, `within()`
   *   dropped all of them, and `ExportScreen` said "Nothing in services for
   *   that period" to a farm that had serviced its tractor that morning.
   *
   * The file's own heading says why it should never have been reading the store
   * here — *built from the same reads the screens use, not from a second pass
   * over the store* — and this was the one sheet that was. So it goes through
   * `listServices`, which resolves the newest completion and falls back to the
   * stored fields for schedules written before completions were events.
   *
   * **A schedule never done still sorts to the epoch and still falls out of a
   * ranged export.** That is unchanged and it is right: nothing happened to it
   * in the period being asked about. It is in the unranged export, where a
   * schedule with no history belongs.
   */
  add(
    'services',
    ['Machine', 'Job', 'Every (hours)', 'Every (days)', 'Last done', 'At hours'],
    services
      .filter((service) => within(service.lastDoneAtDate ?? 0, range))
      .map((service) => [
        named(machineName, service.equipmentId),
        service.title,
        service.intervalHours ?? '',
        service.intervalDays ?? '',
        service.lastDoneAtDate === undefined ? '' : stamp(service.lastDoneAtDate),
        service.lastDoneAtHours ?? '',
        service.equipmentId,
        service.id,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );

  /**
   * ── And the events themselves, which had no sheet at all ──────────────────
   *
   * The schedule sheet says when a job was last done. It cannot say a machine
   * was serviced six times in four years, which is the history somebody hands
   * over with the tractor — the thing P7 is about.
   *
   * `taskCompletion` is deliberately not exported beside it: a chore ticked off
   * is not a maintenance record, and the tasks sheet is not here either.
   *
   * The subject is the machine rather than the schedule, so this sheet joins to
   * `machine-hours` and `services` on the column they all carry. The schedule is
   * still named, because "which oil change" is the question a reader asks next.
   */
  const serviceTitle = new Map(services.map((service) => [service.id, service.title]));
  const serviceMachine = new Map(services.map((service) => [service.id, service.equipmentId]));

  add(
    'service-completions',
    ['When', 'Machine', 'Job', 'At hours', 'Note'],
    await rowsFrom(
      'serviceCompletion',
      serviceCompletionCreateSchema,
      (v) => ({
        at: v.completedAt,
        cells: [
          stamp(v.completedAt),
          named(machineName, serviceMachine.get(v.serviceId)),
          // The schedule may have been archived; the completion is still true.
          serviceTitle.get(v.serviceId) ?? '(archived)',
          v.atHours ?? '',
          v.note ?? '',
        ],
        subject: serviceMachine.get(v.serviceId),
      }),
      range,
    ),
  );

  return sheets;
}
