import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { enqueue } from '@steading/core/sync/queue';
import { readFarmNumbers } from '@steading/core/read/farm-numbers';
import { freshStore } from '../support/store';

/**
 * The whole farm, this year beside last.
 *
 * Reported plainly: *"The Numbers on the farm screen should show ALL data,
 * products, feed, crops etc. not just plants."* The screen was about crops, and
 * a farm keeping hens and a tractor opened it to read about beds.
 *
 * What is asserted here is the arithmetic the crop version never had to do:
 * produce that must not be added across units, a head count that is not a
 * yearly figure at all, and machine hours — which are a **difference between
 * meter readings** and not a sum of them.
 */

const YEAR = 2026;
const GROUP = newId();
const MACHINE = newId();

const on = (year: number, month: number, day: number): number =>
  new Date(year, month, day, 9).getTime();

async function farm(): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
  });
  await enqueue({
    entity: 'equipment',
    op: 'create',
    targetId: MACHINE,
    payload: { name: 'The tractor', make: 'Kubota', hasHourMeter: true },
  });
}

const eggs = (count: number, at: number): Promise<unknown> =>
  enqueue({
    entity: 'eggLog',
    op: 'create',
    targetId: newId(),
    payload: { flockId: GROUP, count, occurredAt: at },
  });

const reading = (hours: number, at: number): Promise<unknown> =>
  enqueue({
    entity: 'hourReading',
    op: 'create',
    targetId: newId(),
    payload: { equipmentId: MACHINE, hours, occurredAt: at },
  });

beforeEach(async () => {
  await freshStore();
  await farm();
});

describe('a farm in its first year', () => {
  it('says so rather than showing a zero for last year', async () => {
    await eggs(12, on(YEAR, 5, 1));

    const { now, before } = await readFarmNumbers(YEAR);

    expect(now.animals.eggs).toBe(12);
    // Null, not an empty year. "Nothing last year" and "no last year" are
    // different sentences and the screen says a different thing for each.
    expect(before).toBeNull();
  });

  /**
   * The check that would have kept this screen honest from the start: a farm
   * with hens and no beds is not an empty farm, and `readNumbers` alone would
   * have called it one.
   */
  it('counts a year with animals and nothing planted', async () => {
    await eggs(30, on(YEAR, 3, 2));

    const { now } = await readFarmNumbers(YEAR);

    expect(now.crops.plantings).toBe(0);
    expect(now.animals.eggs).toBe(30);
  });
});

describe('a year beside the one before it', () => {
  it('keeps the two apart', async () => {
    await eggs(10, on(YEAR, 5, 1));
    await eggs(90, on(YEAR - 1, 5, 1));

    const { now, before } = await readFarmNumbers(YEAR);

    expect(now.animals.eggs).toBe(10);
    expect(before?.animals.eggs).toBe(90);
  });

  /**
   * A previous year is established from any domain, not from plantings alone.
   * A farm that kept hens last year and planted nothing would otherwise be told
   * it had no last year, on a screen showing last year's eggs.
   */
  it('finds a previous year in a domain other than crops', async () => {
    await eggs(40, on(YEAR - 1, 2, 2));

    const { before } = await readFarmNumbers(YEAR);

    expect(before).not.toBeNull();
    expect(before?.animals.eggs).toBe(40);
  });
});

describe('produce', () => {
  it('never adds millilitres to grams', async () => {
    for (const [kind, amount, unit] of [
      ['milk', 4000, 'ml'],
      ['fibre', 900, 'g'],
    ] as const) {
      await enqueue({
        entity: 'productionLog',
        op: 'create',
        targetId: newId(),
        payload: { flockId: GROUP, kind, amount, unit, occurredAt: on(YEAR, 4, 4) },
      });
    }

    const { now } = await readFarmNumbers(YEAR);

    expect(now.animals.produce).toHaveLength(2);
    expect(now.animals.produce.find((p) => p.kind === 'milk')).toMatchObject({
      amount: 4000,
      unit: 'ml',
    });
    expect(now.animals.produce.find((p) => p.kind === 'fibre')).toMatchObject({
      amount: 900,
      unit: 'g',
    });
  });

  it('gathers repeat entries of one kind', async () => {
    for (const amount of [1000, 1500, 900]) {
      await enqueue({
        entity: 'productionLog',
        op: 'create',
        targetId: newId(),
        payload: { flockId: GROUP, kind: 'milk', amount, unit: 'ml', occurredAt: on(YEAR, 4, 4) },
      });
    }

    const { now } = await readFarmNumbers(YEAR);

    expect(now.animals.produce).toHaveLength(1);
    expect(now.animals.produce[0]?.amount).toBe(3400);
  });
});

describe('machine hours', () => {
  /**
   * The mistake this exists to refuse. `hourReading.hours` is the meter face,
   * so summing three readings of a tractor at 100, 140 and 190 hours would
   * report 430 — a number that grows with how carefully somebody writes them
   * down, which punishes the diligent farm.
   */
  it('is the difference between readings, not their sum', async () => {
    await reading(100, on(YEAR, 1, 1));
    await reading(140, on(YEAR, 5, 1));
    await reading(190, on(YEAR, 9, 1));

    const { now } = await readFarmNumbers(YEAR);

    expect(now.machines.hours).toBe(90);
    expect(now.machines.hours).not.toBe(430);
  });

  /** Hours turned before the first entry of the year are not dropped. */
  it('counts from the last reading of the year before', async () => {
    await reading(100, on(YEAR - 1, 11, 20));
    await reading(160, on(YEAR, 6, 1));

    const { now } = await readFarmNumbers(YEAR);

    expect(now.machines.hours).toBe(60);
  });

  it('says nothing for a machine with one reading and no baseline', async () => {
    await reading(500, on(YEAR, 6, 1));

    const { now } = await readFarmNumbers(YEAR);

    // Zero rather than 500: one reading establishes no interval, and the meter
    // face is not a count of hours run this year.
    expect(now.machines.hours).toBe(0);
    expect(now.machines.byMachine).toHaveLength(0);
  });

  /** A replaced meter reads lower than the one before it. No farm ran minus
      four hundred hours. */
  it('never reports a negative when a meter goes backwards', async () => {
    await reading(900, on(YEAR, 1, 1));
    await reading(20, on(YEAR, 8, 1));

    const { now } = await readFarmNumbers(YEAR);

    expect(now.machines.hours).toBe(0);
  });
});

describe('what it will not pretend to know', () => {
  /**
   * Head is what is on the farm now, not a figure for a year. Asking "how many
   * hens in 2025" of a live flock needs a history of every arrival and
   * departure, which the records do not keep.
   */
  it('reports head as it stands rather than per year', async () => {
    await eggs(5, on(YEAR - 1, 5, 1));

    const { now, before } = await readFarmNumbers(YEAR);

    expect(now.animals.head).toBe(6);
    expect(before?.animals.head).toBe(6);
  });
});
