import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { buildExport, field, stamp, toCsv } from '@steading/core/export/csv';
import { enqueue } from '@steading/core/sync/queue';
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
