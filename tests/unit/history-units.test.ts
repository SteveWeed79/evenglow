import { beforeEach, describe, expect, it } from 'vitest';
import { formatProduce, newId } from '@homefarm/contracts';
import { listHistory } from '@homefarm/core/read/history';
import { enqueue } from '@homefarm/core/sync/queue';
import { freshStore } from '../support/store';

/**
 * What happened, in the farm's own units.
 *
 * `productionLog` is the one entity that stores two different quantities under
 * one shape — millilitres for milk, grams for fibre and honey — so the stored
 * number is never the number a farm reads unless somebody converts it.
 *
 * The day summary converted it. The row inside that summary did not, so an
 * imperial farm opened What happened and saw:
 *
 * ```
 * 1 gal · 7.5 lb · …          <- the day
 *   3785 ml milk — The goats  <- the row inside it
 * ```
 *
 * Two figures for the same milking, disagreeing, one line apart. `units.ts`
 * documents `formatProduce` as existing for exactly this — *"that switch was
 * written twice and forgotten once"* — and it had been written three times.
 *
 * **The row title is also its accessibility label**, so this was read aloud as
 * three thousand seven hundred and eighty-five millilitres to somebody who has
 * never used a millilitre.
 */

const GOATS = newId();
const AT = Date.parse('2026-06-10T07:00:00Z');

/** A US gallon in millilitres, which is what a `productionLog` stores. */
const GALLON_ML = 3785;

beforeEach(async () => {
  await freshStore();
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GOATS,
    payload: { name: 'The goats', species: 'goat', count: 4, purposes: ['milk'] },
  });
});

async function produced(kind: string, amount: number, unit: string): Promise<void> {
  await enqueue({
    entity: 'productionLog',
    op: 'create',
    targetId: newId(),
    payload: { occurredAt: AT, flockId: GOATS, kind, amount, unit },
  });
}

/** The one row on the one day. */
async function row(system: 'metric' | 'imperial'): Promise<string> {
  const days = await listHistory(system);
  return days[0]?.events[0]?.title ?? '';
}

describe('a produce row', () => {
  it('is in gallons on an imperial farm, not millilitres', async () => {
    await produced('milk', GALLON_ML, 'ml');

    const title = await row('imperial');

    expect(title).not.toContain('ml');
    expect(title).toBe(`${formatProduce(GALLON_ML, 'ml', 'imperial')} milk — The goats`);
  });

  /** Fibre and honey are stored in grams and have the same problem. */
  it('is in pounds for a weighed produce on an imperial farm', async () => {
    await produced('fibre', 3400, 'g');

    const title = await row('imperial');

    expect(title).not.toMatch(/\b3400 g\b/);
    expect(title).toBe(`${formatProduce(3400, 'g', 'imperial')} fibre — The goats`);
  });

  /**
   * A metric farm reads millilitres because that is its own unit, not because
   * nothing converted it.
   *
   * **The casing changes, and it is a small fix rather than a regression.** The
   * raw interpolation printed the stored unit string, `ml`; `formatProduce`
   * renders the symbol, `mL`. The day summary above the row has always said
   * `mL`, so on a metric farm this row and its summary disagreed about the
   * spelling in the same way an imperial one disagreed about the quantity.
   */
  it('still says millilitres on a metric farm, spelt the way the summary spells it', async () => {
    await produced('milk', 900, 'ml');

    const [day] = await listHistory('metric');

    expect(day?.events[0]?.title).toBe('900 mL milk — The goats');
    expect(day?.summary).toContain('900 mL');
  });

  /**
   * The bug in one assertion: the day above the row and the row itself have to
   * be the same measurement. They were a gallon and 3785 ml.
   */
  it('agrees with the summary it is filed under', async () => {
    await produced('milk', GALLON_ML, 'ml');

    const [day] = await listHistory('imperial');
    const measure = formatProduce(GALLON_ML, 'ml', 'imperial');

    expect(day?.summary).toContain(measure);
    expect(day?.events[0]?.title).toContain(measure);
  });
});
