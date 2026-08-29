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

/** Local midday on a date, so a fixture is never an hour away from another year. */
const on = (year: number, month: number, day: number): number =>
  new Date(year, month, day, 12).getTime();

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
  /**
   * **Last year's pick is now dated last year, and it was not before.**
   *
   * This used to plant in `YEAR - 1` and pick with `Date.now()`, then assert
   * the 8 kg landed in the previous season — which passed only because the
   * numbers were bucketed by the planting's stamped season and not by when
   * anything was picked. It was the assertion holding that behaviour in place.
   *
   * A pick made today is this year's pick whatever year the seed went in, so
   * the fixture now says when it happened.
   */
  it('keeps the two apart', async () => {
    const thisYear = await plant(BED_A, TOMATO, YEAR);
    const lastYear = await plant(BED_A, TOMATO, YEAR - 1);
    await pick(thisYear, { massUg: 3 * KG });
    await pick(lastYear, { massUg: 8 * KG, occurredAt: on(YEAR - 1, 7, 20) });

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

/**
 * ── The year a thing was picked, not the year it was planted ───────────────
 *
 * `planting.season` is stamped when the planting is created and never moves.
 * For an annual sown and picked inside one year it is the same number as the
 * year of the pick, which is why bucketing by it read correctly for as long as
 * nobody grew anything else.
 *
 * Anything that overwinters or comes back breaks the equivalence, and those are
 * first-class shapes in the bundled library rather than corner cases:
 * `library/crops.ts` has garlic as autumn-sown, and asparagus, rhubarb,
 * raspberry, blueberry and strawberry as perennials.
 *
 * The perennial is the worse of the two. Its planting is stamped once, so every
 * year after the first reported nothing off that bed for ever — and the
 * previous-season column, the reason this screen exists at all, compared a year
 * of picking against a year that had been credited with all of it.
 */
describe('a crop that does not begin and end in one year', () => {
  const RHUBARB = newId();
  const GARLIC = newId();

  beforeEach(async () => {
    for (const [id, name, crop] of [
      [RHUBARB, 'Victoria', 'Rhubarb'],
      [GARLIC, 'Music', 'Garlic'],
    ] as const) {
      await enqueue({
        entity: 'variety',
        op: 'create',
        targetId: id,
        payload: { name, crop, family: 'other', lifecycle: 'perennial' },
      });
    }
  });

  /** A crown put in two years ago, cropping now. It read 0 kg, 0 picks. */
  it('credits a perennial to the year it was actually picked', async () => {
    const crown = await plant(BED_A, RHUBARB, YEAR - 2);
    await pick(crown, { massUg: 8 * KG, occurredAt: on(YEAR, 4, 12) });

    const { now } = await readNumbers(YEAR);

    expect(now.massUg).toBe(8 * KG);
    expect(now.picks).toBe(1);
    expect(now.byCrop).toEqual([{ crop: 'Rhubarb', massUg: 8 * KG, count: 0, picks: 1 }]);
  });

  /** Sown in the autumn, lifted the next July. It was filed under the sowing. */
  it('does not file an autumn sowing under the year it went in', async () => {
    const sown = await plant(BED_A, GARLIC, YEAR - 1);
    await pick(sown, { massUg: 3 * KG, occurredAt: on(YEAR, 6, 4) });

    const { now, before } = await readNumbers(YEAR);

    expect(now.massUg).toBe(3 * KG);
    // The sowing is still last year's — that is a different question, and the
    // answer to it was never wrong.
    expect(before?.plantings).toBe(1);
    expect(before?.massUg).toBe(0);
  });

  /**
   * **`byBed` has to sum to the season it is under.**
   *
   * The bed rows are seeded from the plantings loop, one per season something
   * went IN. A bed whose only planting is a crown from two years ago has no row
   * in this year — so a pick keyed by its own year had a season total to add to
   * and no bed row to appear against, and the screen would contradict itself in
   * the space of two rows: eight kilos at the top, nothing against any bed
   * below. The row is created on demand rather than the pick being dropped.
   */
  it('gives the pick a bed row in the year it happened', async () => {
    const crown = await plant(BED_A, RHUBARB, YEAR - 2);
    await pick(crown, { massUg: 8 * KG, occurredAt: on(YEAR, 4, 12) });

    const { now } = await readNumbers(YEAR);
    const byBed = now.byBed.reduce((total, bed) => total + bed.massUg, 0);

    expect(byBed).toBe(now.massUg);
    expect(now.byBed).toEqual([
      { bedId: BED_A, bed: 'The top bed', massUg: 8 * KG, count: 0, picks: 1, crops: ['Rhubarb'] },
    ]);
  });

  /**
   * A bed cropping in two years running gets one row in each, and the year it
   * was planted does not double-count the year it was picked.
   */
  it('splits a perennials picks across the years they fell in', async () => {
    const crown = await plant(BED_A, RHUBARB, YEAR - 1);
    await pick(crown, { massUg: 5 * KG, occurredAt: on(YEAR - 1, 4, 12) });
    await pick(crown, { massUg: 8 * KG, occurredAt: on(YEAR, 4, 12) });

    const { now, before } = await readNumbers(YEAR);

    expect(now.massUg).toBe(8 * KG);
    expect(before?.massUg).toBe(5 * KG);
    expect(now.picks).toBe(1);
    expect(before?.picks).toBe(1);
  });
});
