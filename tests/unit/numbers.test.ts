import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@homefarm/contracts';
import { enqueue } from '@homefarm/core/sync/queue';
import { readNumbers } from '@homefarm/core/read/numbers';
import { freshStore } from '../support/store';

/**
 * What came off the farm, this season beside last.
 *
 * ## Two columns, not one
 *
 * The single thing this app has that a notebook does not is the previous year
 * sitting next to this one. A totals screen showing only the season in progress
 * throws away the only figure that means anything in August: what the same bed
 * did by this point last year. So every number here is a pair.
 *
 * ## Derived, never stored
 *
 * The same rule the due engine follows. `listHarvests` says it out loud — *the
 * sum is a question, not a fact to keep in step* — because a total kept beside
 * an append-only log is a total that will one day disagree with it.
 */

const SITE = newId();
const BED_A = newId();
const BED_B = newId();
const TOMATO = newId();
const PUMPKIN = newId();

const YEAR = 2026;
const KG = 1_000_000_000;

async function farm(): Promise<void> {
  await enqueue({
    entity: 'site',
    op: 'create',
    targetId: SITE,
    payload: { name: 'The farm', zone: { system: 'usda', value: '7a' } },
  });
  for (const [id, name] of [
    [BED_A, 'The top bed'],
    [BED_B, 'The long bed'],
  ] as const) {
    await enqueue({
      entity: 'bed',
      op: 'create',
      targetId: id,
      payload: { siteId: SITE, name, covered: false },
    });
  }
  await enqueue({
    entity: 'variety',
    op: 'create',
    targetId: TOMATO,
    payload: { name: 'Roma', crop: 'Tomato', family: 'solanaceae', lifecycle: 'annual' },
  });
  await enqueue({
    entity: 'variety',
    op: 'create',
    targetId: PUMPKIN,
    payload: { name: 'Black Futsu', crop: 'Pumpkin', family: 'cucurbit', lifecycle: 'annual' },
  });
}

async function plant(bedId: string, varietyId: string, season: number): Promise<string> {
  const id = newId();
  await enqueue({
    entity: 'planting',
    op: 'create',
    targetId: id,
    payload: { bedId, varietyId, season, status: 'in-ground' },
  });
  return id;
}

async function pick(plantingId: string, over: Record<string, unknown>): Promise<void> {
  await enqueue({
    entity: 'harvest',
    op: 'create',
    targetId: newId(),
    payload: {
      plantingId,
      occurredAt: Date.now(),
      // The unit says which of massUg / count the row carries; the schema
      // refuses a mismatch, which is why it is derived rather than passed.
      unit: 'massUg' in over ? 'mass' : 'count',
      ...over,
    },
  });
}

beforeEach(async () => {
  await freshStore();
  await farm();
});

describe('a farm in its first season', () => {
  it('says so rather than showing a zero for last year', async () => {
    const p = await plant(BED_A, TOMATO, YEAR);
    await pick(p, { massUg: 3 * KG });

    const { now, before } = await readNumbers(YEAR);

    expect(now.massUg).toBe(3 * KG);
    // Null, not an empty season. "Nothing last year" and "no last year" are
    // different sentences and the screen says a different thing for each.
    expect(before).toBeNull();
  });
});

describe('a season beside the one before it', () => {
  it('keeps the two apart', async () => {
    const thisYear = await plant(BED_A, TOMATO, YEAR);
    const lastYear = await plant(BED_A, TOMATO, YEAR - 1);
    await pick(thisYear, { massUg: 3 * KG });
    await pick(lastYear, { massUg: 8 * KG });

    const { now, before } = await readNumbers(YEAR);

    expect(now.massUg).toBe(3 * KG);
    expect(before?.massUg).toBe(8 * KG);
  });

  it('counts pickings as well as weight, because a season has a shape', async () => {
    const p = await plant(BED_A, TOMATO, YEAR);
    await pick(p, { massUg: 1 * KG });
    await pick(p, { massUg: 1 * KG });
    await pick(p, { massUg: 1 * KG });

    const { now } = await readNumbers(YEAR);

    expect(now.picks).toBe(3);
    expect(now.massUg).toBe(3 * KG);
  });

  /** Some crops are weighed and some are counted. Both are real totals. */
  it('keeps counted things separate from weighed things', async () => {
    const p = await plant(BED_A, PUMPKIN, YEAR);
    await pick(p, { count: 4 });

    const { now } = await readNumbers(YEAR);

    expect(now.count).toBe(4);
    expect(now.massUg).toBe(0);
  });
});

describe('by crop and by bed', () => {
  it('gathers pickings under the crop rather than the variety', async () => {
    const a = await plant(BED_A, TOMATO, YEAR);
    const b = await plant(BED_B, TOMATO, YEAR);
    await pick(a, { massUg: 2 * KG });
    await pick(b, { massUg: 3 * KG });

    const { now } = await readNumbers(YEAR);

    expect(now.byCrop).toHaveLength(1);
    expect(now.byCrop[0]?.crop).toBe('Tomato');
    expect(now.byCrop[0]?.massUg).toBe(5 * KG);
  });

  it('puts the heaviest first, because that is how a season is read', async () => {
    const light = await plant(BED_A, TOMATO, YEAR);
    const heavy = await plant(BED_B, PUMPKIN, YEAR);
    await pick(light, { massUg: 1 * KG });
    await pick(heavy, { massUg: 9 * KG });

    const { now } = await readNumbers(YEAR);

    expect(now.byCrop.map((c) => c.crop)).toEqual(['Pumpkin', 'Tomato']);
  });

  /**
   * A bed with a planting and no pickings is a different state from a bed with
   * nothing in it, and only one of those is a question worth asking.
   */
  it('shows a bed that has been planted but not yet picked', async () => {
    await plant(BED_A, TOMATO, YEAR);

    const { now } = await readNumbers(YEAR);

    expect(now.byBed).toHaveLength(1);
    expect(now.byBed[0]?.bed).toBe('The top bed');
    expect(now.byBed[0]?.picks).toBe(0);
    expect(now.byBed[0]?.crops).toEqual(['Tomato']);
  });

  it('names everything grown in a bed this season', async () => {
    await plant(BED_A, TOMATO, YEAR);
    await plant(BED_A, PUMPKIN, YEAR);

    const { now } = await readNumbers(YEAR);

    expect(now.byBed[0]?.crops.sort()).toEqual(['Pumpkin', 'Tomato']);
  });
});

describe('what it refuses to guess', () => {
  /**
   * A pick whose planting is gone cannot be placed in a season, so it is not
   * counted against one. The row is still in the store — nothing is deleted —
   * it simply has no season to belong to.
   */
  it('does not file a picking it cannot place', async () => {
    await pick(newId(), { massUg: 5 * KG });

    const { now } = await readNumbers(YEAR);

    expect(now.massUg).toBe(0);
    expect(now.picks).toBe(0);
  });

  it('counts plantings whatever became of them', async () => {
    await plant(BED_A, TOMATO, YEAR);
    await plant(BED_B, PUMPKIN, YEAR);

    const { now } = await readNumbers(YEAR);

    expect(now.plantings).toBe(2);
  });
});
