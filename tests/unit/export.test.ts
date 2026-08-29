import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { buildExport, field, stamp, toCsv } from '@homefarm/core/export/csv';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';

/**
 * Getting a farm's records out.
 *
 * Parity floor P7 and P9. The app could show two years of records and had no
 * way to hand any of them to an accountant, a vet, or somebody buying a
 * tractor — and a farm that cannot get its data out is a farm that cannot
 * leave.
 *
 * Most of what follows is about escaping, because escaping is the whole
 * difficulty. A CSV that is subtly wrong is worse than none: it opens, it
 * looks fine, and the row it corrupted is the one somebody needed.
 */

const GROUP = newId();

async function theHens(name = 'The hens'): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name, species: 'chicken', count: 6, purposes: ['eggs'] },
  });
}

beforeEach(async () => {
  await freshStore();
});

describe('one field', () => {
  it('leaves an ordinary value alone', () => {
    expect(field('The hens')).toBe('The hens');
    expect(field(12)).toBe('12');
  });

  it('quotes a comma, which is the one that breaks every row after it', () => {
    expect(field('Found her down, called the vet')).toBe('"Found her down, called the vet"');
  });

  it('doubles a quote inside a quoted field', () => {
    expect(field('The "back" run')).toBe('"The ""back"" run"');
  });

  it('quotes a newline rather than ending the record', () => {
    expect(field('two\nlines')).toBe('"two\nlines"');
  });

  it('is empty for nothing at all', () => {
    expect(field(undefined)).toBe('');
    expect(field(null)).toBe('');
    expect(field('')).toBe('');
  });

  /**
   * CSV injection, which is on the OWASP list and is the one people forget.
   *
   * Excel and Sheets treat a leading `=`, `+`, `-`, `@`, tab or carriage
   * return as the start of a formula. A group named `=1+1` becomes a
   * calculation; a hostile value becomes something considerably worse. An
   * apostrophe is the documented fix — the sheet shows the text and evaluates
   * nothing.
   */
  it('defuses a value a spreadsheet would treat as a formula', () => {
    expect(field('=1+1')).toBe("'=1+1");
    expect(field('+44 7700 900000')).toBe("'+44 7700 900000");
    expect(field('-5')).toBe("'-5");
    expect(field('@handle')).toBe("'@handle");
  });

  it('defuses and quotes together when a value needs both', () => {
    // The guard goes on first, then the quoting wraps the guarded value —
    // the other order puts the apostrophe outside the quotes, where the
    // spreadsheet never sees it.
    expect(field('=cmd,"x"')).toBe('"\'=cmd,""x"""');
  });

  /** A number that happens to be negative is a number, not an attack. */
  it('still exports a negative number readably', () => {
    // Guarded, because -5 typed by a person and -5 from a formula look
    // identical here. A leading apostrophe costs a reader nothing; a live
    // formula costs them their spreadsheet.
    expect(field(-5)).toBe("'-5");
  });
});

describe('a whole sheet', () => {
  it('puts the header first and separates records with CRLF', () => {
    const csv = toCsv(['When', 'Eggs'], [['2026-08-03 08:00', 12]]);
    expect(csv).toBe('When,Eggs\r\n2026-08-03 08:00,12');
  });

  /** RFC 4180 says CRLF, and Excel on Windows is where these land. */
  it('uses CRLF rather than bare newlines', () => {
    const csv = toCsv(['a'], [['1'], ['2']]);
    expect(csv.split('\r\n')).toHaveLength(3);
  });
});

describe('the timestamp', () => {
  it('is local and in a shape a spreadsheet parses without being asked', () => {
    const at = new Date(2026, 7, 3, 8, 5).getTime();
    expect(stamp(at)).toBe('2026-08-03 08:05');
  });
});

describe('what comes out', () => {
  it('exports the eggs a farm logged', async () => {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now(), flockId: GROUP, count: 12 },
    });

    const sheets = await buildExport();
    const eggs = sheets.find((s) => s.name === 'eggs');

    expect(eggs?.rows).toBe(1);
    expect(eggs?.csv).toContain('The hens');
    expect(eggs?.csv).toContain('12');
  });

  /**
   * A market gardener does not want eleven files about animals they do not
   * keep, and a lone header row reads as data that went missing.
   */
  it('leaves out a sheet with nothing in it', async () => {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now(), flockId: GROUP, count: 12 },
    });

    const sheets = await buildExport();

    expect(sheets.map((s) => s.name)).toEqual(['eggs']);
  });

  it('exports nothing at all for a farm that has logged nothing', async () => {
    await theHens();
    expect(await buildExport()).toEqual([]);
  });

  it('honours a date range', async () => {
    await theHens();
    const now = Date.now();
    for (const daysAgo of [0, 10, 40]) {
      await enqueue({
        entity: 'eggLog',
        op: 'create',
        targetId: newId(),
        payload: { occurredAt: now - daysAgo * 86_400_000, flockId: GROUP, count: 6 },
      });
    }

    const sheets = await buildExport({ from: now - 20 * 86_400_000 });
    expect(sheets.find((s) => s.name === 'eggs')?.rows).toBe(2);
  });

  /**
   * Invariant 13 reaching the export: hiding a group must not silently rewrite
   * what happened while it was here. A blank cell would read as a bug in the
   * file rather than as a group that has been put away.
   */
  it('keeps the records of an archived group, and says the subject is gone', async () => {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now(), flockId: GROUP, count: 6 },
    });
    await enqueue({ entity: 'flock', op: 'delete', targetId: GROUP, payload: {} });

    const eggs = (await buildExport()).find((s) => s.name === 'eggs');

    expect(eggs?.rows).toBe(1);
    expect(eggs?.csv).toContain('(archived)');
  });

  /** The sheet a vet or an inspector asks for. */
  it('exports treatments with their withdrawal periods', async () => {
    await theHens();
    await enqueue({
      entity: 'medication',
      op: 'create',
      targetId: newId(),
      payload: {
        flockId: GROUP,
        name: 'Baytril',
        administeredAt: Date.now(),
        treatmentEndsAt: Date.now(),
        withdrawalDays: { egg: 7 },
      },
    });

    const treatments = (await buildExport()).find((s) => s.name === 'treatments');

    expect(treatments?.csv).toContain('Baytril');
    expect(treatments?.csv).toContain('The hens');
  });

  /**
   * The escaping, end to end rather than only on `field`. A farm really does
   * name a run "The 'back' run, by the gate".
   */
  it('survives a group name that would break a naive writer', async () => {
    await theHens('The "back" run, by the gate');
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now(), flockId: GROUP, count: 6 },
    });

    const eggs = (await buildExport()).find((s) => s.name === 'eggs');

    // One header line and one data line — the comma in the name did not
    // become a column, and the quotes did not end the field.
    expect(eggs?.csv.split('\r\n')).toHaveLength(2);
    expect(eggs?.csv).toContain('"The ""back"" run, by the gate"');
  });
});

/**
 * Names are what a person reads; they are not an identity.
 *
 * The gap assessment asked for "reports carrying human-readable names beside
 * stable identifiers" and the export already had the names — every sheet
 * resolved a ULID to one — and printed no identifier at all. So the half that
 * was missing is the half that answers *which* Big coop, and lets a season's
 * rows be joined back to anything.
 */
describe('the identifier beside the name', () => {
  it('ends every sheet with the subject and the record', async () => {
    await theHens();
    const log = newId();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: log,
      payload: { occurredAt: Date.now(), flockId: GROUP, count: 12 },
    });

    const eggs = (await buildExport()).find((s) => s.name === 'eggs');
    const [header, row] = eggs?.csv.split('\r\n') ?? [];

    expect(header?.endsWith('Subject id,Record id')).toBe(true);
    expect(row?.endsWith(`${GROUP},${log}`)).toBe(true);
  });

  /** The case the words cannot answer, and the reason this column exists. */
  it('tells two groups of the same name apart', async () => {
    const second = newId();
    await theHens('Big coop');
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: second,
      payload: { name: 'Big coop', species: 'chicken', count: 9, purposes: ['eggs'] },
    });

    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now(), flockId: GROUP, count: 12 },
    });
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now(), flockId: second, count: 7 },
    });

    const eggs = (await buildExport()).find((s) => s.name === 'eggs');
    const rows = eggs?.csv.split('\r\n').slice(1) ?? [];

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.includes('Big coop'))).toBe(true);
    // Identical in every column a person reads, and separable anyway.
    expect(rows.filter((r) => r.includes(GROUP))).toHaveLength(1);
    expect(rows.filter((r) => r.includes(second))).toHaveLength(1);
  });

  /**
   * An archived subject reads `(archived)` for every group at once, which is
   * exactly when the id is the only thing left that distinguishes them.
   */
  it('still carries the id when the subject is gone', async () => {
    await theHens();
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now(), flockId: GROUP, count: 6 },
    });
    await enqueue({ entity: 'flock', op: 'delete', targetId: GROUP, payload: {} });

    const eggs = (await buildExport()).find((s) => s.name === 'eggs');

    expect(eggs?.csv).toContain('(archived)');
    expect(eggs?.csv).toContain(GROUP);
  });

  /** A sighting is about no record, so the column is empty rather than absent. */
  it('leaves the subject blank where a row is about nothing in particular', async () => {
    await enqueue({
      entity: 'predator',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: Date.now(), species: 'Fox', lossCount: 2 },
    });

    const sheet = (await buildExport()).find((s) => s.name === 'predators');
    const [header, row] = sheet?.csv.split('\r\n') ?? [];

    expect(header?.endsWith('Subject id,Record id')).toBe(true);
    expect(row).toMatch(/,,[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

/**
 * ── The sheet that read a field nothing writes ─────────────────────────────
 *
 * A service is discharged by a `serviceCompletion` event. `ServiceDoneScreen`
 * writes one and never touches the `maintenance` schedule; `read/iron.ts` and
 * `read/history.ts` were both moved over to resolve it. The export was not, and
 * went on reading `maintenance.lastDoneAtDate` straight out of the store.
 *
 * Two different failures, and the second is the one that reads as a broken app:
 *
 * - export **everything** → `Last done` and `At hours` blank on every row,
 *   however many services the farm had actually recorded;
 * - export **the last year** → `at` was the epoch for every row, `within()`
 *   dropped all of them, and `ExportScreen` said *"Nothing in services for that
 *   period"* to a farm that had serviced its tractor that morning.
 *
 * The file's own heading says why this could not have been right: *built from
 * the same reads the screens use, not from a second pass over the store*. This
 * was the one sheet that was.
 */
describe('the service sheets', () => {
  const TRACTOR = newId();
  const OIL = newId();
  const DAY = 86_400_000;

  /** Yesterday, so a "last year" range is unambiguous either side. */
  const DONE_AT = Date.now() - DAY;

  async function theTractor(): Promise<void> {
    await enqueue({
      entity: 'equipment',
      op: 'create',
      targetId: TRACTOR,
      payload: { name: 'The Kubota', make: 'Kubota', hasHourMeter: true },
    });
    await enqueue({
      entity: 'maintenance',
      op: 'create',
      targetId: OIL,
      payload: { equipmentId: TRACTOR, title: 'Oil and filter', intervalHours: 200 },
    });
  }

  /** What ServiceDoneScreen writes. Note it never touches the schedule. */
  async function serviced(completedAt: number, atHours?: number): Promise<void> {
    await enqueue({
      entity: 'serviceCompletion',
      op: 'create',
      targetId: newId(),
      payload: { serviceId: OIL, completedAt, ...(atHours === undefined ? {} : { atHours }) },
    });
  }

  const sheet = (sheets: { name: string; csv: string }[], name: string): string | undefined =>
    sheets.find((s) => s.name === name)?.csv;

  beforeEach(async () => {
    await theTractor();
  });

  it('fills Last done and At hours from the completion', async () => {
    await serviced(DONE_AT, 1240);

    const services = sheet(await buildExport(), 'services');

    expect(services).toContain('Oil and filter');
    expect(services).toContain(stamp(DONE_AT));
    expect(services).toContain('1240');
  });

  /** The one that said "Nothing in services for that period." */
  it('keeps a serviced machine inside a ranged export', async () => {
    await serviced(DONE_AT, 1240);

    const lastYear = await buildExport({ from: Date.now() - 365 * DAY });

    expect(sheet(lastYear, 'services')).toContain('Oil and filter');
  });

  /**
   * A schedule that has never been done still sorts to the epoch and still
   * falls out of a ranged export. That is unchanged and it is right — nothing
   * happened to it in the period being asked about — and it is present in the
   * export of everything, where a schedule with no history belongs.
   */
  it('leaves a never-done schedule out of a range and in the whole', async () => {
    expect(sheet(await buildExport(), 'services')).toContain('Oil and filter');
    expect(sheet(await buildExport({ from: Date.now() - 365 * DAY }), 'services')).toBeUndefined();
  });

  /**
   * The schedule sheet says when a job was last done. It cannot say a machine
   * was serviced six times in four years, which is the history somebody hands
   * over with the tractor. There was no sheet for the events at all.
   */
  it('exports every completion, not only the latest', async () => {
    await serviced(DONE_AT - 400 * DAY, 900);
    await serviced(DONE_AT - 200 * DAY, 1050);
    await serviced(DONE_AT, 1240);

    const done = sheet(await buildExport(), 'service-completions');
    const rows = (done ?? '').split('\r\n').slice(1);

    expect(rows).toHaveLength(3);
    expect(done).toContain('The Kubota');
    expect(done).toContain('Oil and filter');
    // The schedule sheet still carries only the newest.
    expect(sheet(await buildExport(), 'services')).not.toContain('900');
  });

  /**
   * The subject is the machine, so this sheet joins to `machine-hours` and
   * `services` on the column all three carry.
   */
  it('files a completion against the machine, not the schedule', async () => {
    await serviced(DONE_AT, 1240);

    const done = sheet(await buildExport(), 'service-completions') ?? '';
    const [header, row] = done.split('\r\n');

    expect(header?.split(',').at(-2)).toBe('Subject id');
    expect(row?.split(',').at(-2)).toBe(TRACTOR);
  });
});
