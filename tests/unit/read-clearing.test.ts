import { beforeEach, describe, expect, it } from 'vitest';
import { careDues, incubationDues, newId, serviceDue } from '@steading/contracts';
import { listAnimals, possibleDams } from '@steading/core/read/animals';
import {
  fertilityRate,
  hatchRate,
  latestWeightBySubject,
  listBreedings,
  listIncubations,
  listWeights,
} from '@steading/core/read/breeding';
import { lastCareBySubject, listCareLogs } from '@steading/core/read/care';
import { lastFedByGroup, lossesByGroup, produceToday } from '@steading/core/read/groups';
import { harvestTotals, listHarvests } from '@steading/core/read/growing';
import { listInventory, listServices, runningLow } from '@steading/core/read/iron';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';

/**
 * The reads that make a due row disappear.
 *
 * Every builder in `contracts/due` was written and tested against hand-built
 * inputs long before anything in the app could produce the records those
 * inputs describe. That gap had a visible symptom: seven husbandry rows per
 * group that no action could clear, and no birth, hatch or service row at all.
 *
 * These suites close the loop the tests never covered — enqueue the real
 * mutation the real screen sends, read it back through the real reader, and
 * assert the builder now behaves differently. A unit test of `careDues` alone
 * cannot catch a reader that returns nothing.
 */

const DAY = 86_400_000;
const T0 = new Date('2026-07-01T08:00:00Z').getTime();

const GROUP = '01J0000000000000000000FL0K';
const ANIMAL = '01J0000000000000000000AN1M';
const MACHINE = '01J000000000000000000MACH1';
const PLANTING = '01J00000000000000000PLANT1';

beforeEach(async () => {
  await freshStore();
});

describe('husbandry clears because the job was recorded', () => {
  it('is due within the week while nothing has been logged', async () => {
    const dues = careDues(
      { id: GROUP, name: 'The goats', species: 'goat', lastDone: {} },
      T0,
    );
    const trim = dues.find((d) => d.key.endsWith(':care:hoof-trim'));

    // A week's grace from when the group was added, and then it asks — not one
    // full interval, because a farm that has never recorded trimming either is
    // not trimming or is not recording it, and eight quiet weeks would hide
    // both. See GRACE_DAYS.
    expect(trim?.at).toBe(T0 + 7 * 86_400_000);
    expect(trim?.at).toBeLessThan(T0 + 56 * 86_400_000);
  });

  it('moves an interval out once a careLog exists', async () => {
    await enqueue({
      entity: 'careLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: T0, kind: 'hoof-trim', flockId: GROUP },
    });

    const lastDone = lastCareBySubject(await listCareLogs()).get(GROUP) ?? {};
    expect(lastDone['hoof-trim']).toBe(T0);

    const dues = careDues(
      { id: GROUP, name: 'The goats', species: 'goat', lastDone },
      T0,
    );
    // A goat's feet come round every 56 days.
    expect(dues.find((d) => d.key.endsWith(':care:hoof-trim'))?.at).toBe(T0 + 56 * DAY);
  });

  it('takes the latest date, not the last row written', async () => {
    // Somebody catching up on Sunday enters Tuesday's worming after
    // Thursday's. Taking the last row would restart the clock earlier.
    for (const occurredAt of [T0 + 3 * DAY, T0]) {
      await enqueue({
        entity: 'careLog',
        op: 'create',
        targetId: newId(),
        payload: { occurredAt, kind: 'worming', flockId: GROUP },
      });
    }

    const lastDone = lastCareBySubject(await listCareLogs()).get(GROUP) ?? {};
    expect(lastDone.worming).toBe(T0 + 3 * DAY);
  });

  it('keeps one group’s jobs out of another’s', async () => {
    await enqueue({
      entity: 'careLog',
      op: 'create',
      targetId: newId(),
      payload: { occurredAt: T0, kind: 'worming', flockId: GROUP },
    });

    const bySubject = lastCareBySubject(await listCareLogs());
    expect(bySubject.get('01J0000000000000000000OTHR')).toBeUndefined();
  });
});

describe('incubations', () => {
  const set = async (over: Record<string, unknown> = {}) => {
    const id = newId();
    await enqueue({
      entity: 'incubation',
      op: 'create',
      targetId: id,
      payload: {
        species: 'chicken',
        label: 'The Sussex set',
        setAt: T0,
        eggsSet: 12,
        source: 'own',
        method: 'incubator',
        ...over,
      },
    });
    return id;
  };

  it('produces a candling row and a hatch row', async () => {
    await set();
    const [incubation] = await listIncubations();
    const dues = incubationDues(incubation!, incubation!.label);

    expect(dues.map((d) => d.kind)).toEqual(['candle', 'hatch']);
    // Day 7 for a chicken; 21 days to hatch.
    expect(dues[0]!.at).toBe(T0 + 7 * DAY);
    expect(dues[1]!.at).toBe(T0 + 21 * DAY);
  });

  it('drops the candling row once candling is recorded', async () => {
    const id = await set();
    await enqueue({
      entity: 'incubation',
      op: 'update',
      targetId: id,
      payload: { candledAt: T0 + 7 * DAY, fertile: 9 },
    });

    const [incubation] = await listIncubations();
    expect(incubationDues(incubation!, 'x').map((d) => d.kind)).toEqual(['hatch']);
  });

  it('drops both once it has hatched', async () => {
    const id = await set();
    await enqueue({
      entity: 'incubation',
      op: 'update',
      targetId: id,
      payload: { hatchedAt: T0 + 21 * DAY, hatched: 8 },
    });

    const [incubation] = await listIncubations();
    expect(incubationDues(incubation!, 'x')).toEqual([]);
    expect(hatchRate(incubation!)).toBeCloseTo(8 / 12, 5);
  });

  it('reports no rate before the step has happened', async () => {
    await set();
    const [incubation] = await listIncubations();
    // Zero would be a claim about a bad hatch; null is the truth.
    expect(hatchRate(incubation!)).toBeNull();
    expect(fertilityRate(incubation!)).toBeNull();
  });
});

describe('matings', () => {
  it('reads back with the fields a birth due needs', async () => {
    await enqueue({
      entity: 'breeding',
      op: 'create',
      targetId: newId(),
      payload: { species: 'goat', damId: ANIMAL, bredAt: T0, method: 'natural' },
    });

    const [breeding] = await listBreedings();
    expect(breeding?.damId).toBe(ANIMAL);
    expect(breeding?.bornAt).toBeUndefined();
  });

  it('carries the outcome once it is filled in', async () => {
    const id = newId();
    await enqueue({
      entity: 'breeding',
      op: 'create',
      targetId: id,
      payload: { species: 'goat', damId: ANIMAL, bredAt: T0, method: 'natural' },
    });
    await enqueue({
      entity: 'breeding',
      op: 'update',
      targetId: id,
      payload: { bornAt: T0 + 150 * DAY, liveBorn: 2, stillborn: 0 },
    });

    const [breeding] = await listBreedings();
    expect(breeding?.bornAt).toBe(T0 + 150 * DAY);
    expect(breeding?.liveBorn).toBe(2);
  });
});

describe('service schedules', () => {
  it('reads an hours interval a machine can be measured against', async () => {
    await enqueue({
      entity: 'maintenance',
      op: 'create',
      targetId: newId(),
      payload: { equipmentId: MACHINE, title: 'Oil and filter', intervalHours: 100 },
    });

    const [service] = await listServices();
    expect(service?.intervalHours).toBe(100);

    const due = serviceDue(
      { id: MACHINE, name: 'The tractor', hasHourMeter: true, hours: 240, usagePerDay: 2 },
      { id: service!.id, name: service!.title, everyHours: service!.intervalHours },
      T0,
    );
    // Counted from zero, not from the current reading: a machine bought at 900
    // hours with no history is overdue and should say so.
    expect(due?.atReading).toBe(100);
  });

  it('counts from the last service once one is recorded', async () => {
    const id = newId();
    await enqueue({
      entity: 'maintenance',
      op: 'create',
      targetId: id,
      payload: { equipmentId: MACHINE, title: 'Oil and filter', intervalHours: 100 },
    });
    await enqueue({
      entity: 'maintenance',
      op: 'update',
      targetId: id,
      payload: { lastDoneAtHours: 240, lastDoneAtDate: T0 },
    });

    const [service] = await listServices();
    const due = serviceDue(
      { id: MACHINE, name: 'The tractor', hasHourMeter: true, hours: 240, usagePerDay: 2 },
      {
        id: service!.id,
        name: service!.title,
        everyHours: service!.intervalHours,
        lastDoneAtHours: service!.lastDoneAtHours,
      },
      T0,
    );
    expect(due?.atReading).toBe(340);
  });
});

describe('the shelf', () => {
  it('warns only about items given a threshold', async () => {
    await enqueue({
      entity: 'inventory',
      op: 'create',
      targetId: newId(),
      payload: { name: 'Oil filter', kind: 'part', unit: 'each', quantity: 0, reorderBelow: 1 },
    });
    await enqueue({
      entity: 'inventory',
      op: 'create',
      targetId: newId(),
      payload: { name: 'Straw', kind: 'bedding', unit: 'bale', quantity: 0 },
    });

    const items = await listInventory();
    expect(items).toHaveLength(2);
    // A farm that has not set a threshold is not a farm that is short.
    expect(runningLow(items).map((i) => i.name)).toEqual(['Oil filter']);
  });

  it('follows an in-place quantity edit', async () => {
    const id = newId();
    await enqueue({
      entity: 'inventory',
      op: 'create',
      targetId: id,
      payload: { name: 'Oil filter', kind: 'part', unit: 'each', quantity: 0, reorderBelow: 1 },
    });
    await enqueue({ entity: 'inventory', op: 'update', targetId: id, payload: { quantity: 4 } });

    expect(runningLow(await listInventory())).toEqual([]);
  });
});

describe('harvests', () => {
  it('sums mass and count separately across picks', async () => {
    for (const massUg of [1_000_000, 2_500_000]) {
      await enqueue({
        entity: 'harvest',
        op: 'create',
        targetId: newId(),
        payload: { plantingId: PLANTING, occurredAt: T0, unit: 'mass', massUg },
      });
    }
    await enqueue({
      entity: 'harvest',
      op: 'create',
      targetId: newId(),
      payload: { plantingId: PLANTING, occurredAt: T0, unit: 'count', count: 6 },
    });

    const totals = harvestTotals(await listHarvests(), PLANTING);
    expect(totals).toEqual({ massUg: 3_500_000, count: 6, picks: 3 });
  });

  it('counts only the planting asked about', async () => {
    await enqueue({
      entity: 'harvest',
      op: 'create',
      targetId: newId(),
      payload: { plantingId: PLANTING, occurredAt: T0, unit: 'count', count: 3 },
    });

    expect(harvestTotals(await listHarvests(), '01J000000000000000000OTHR1').picks).toBe(0);
  });
});

describe('the rest of what a group produces', () => {
  it('adds two milkings into one day', async () => {
    const occurredAt = Date.now();
    for (const amount of [1_200, 900]) {
      await enqueue({
        entity: 'productionLog',
        op: 'create',
        payload: { occurredAt, flockId: GROUP, kind: 'milk', amount, unit: 'ml' },
      });
    }

    expect((await produceToday()).get(`${GROUP}:milk`)?.amount).toBe(2_100);
  });

  it('keeps milk and fibre apart rather than summing two units', async () => {
    const occurredAt = Date.now();
    await enqueue({
      entity: 'productionLog',
      op: 'create',
      payload: { occurredAt, flockId: GROUP, kind: 'milk', amount: 1_000, unit: 'ml' },
    });
    await enqueue({
      entity: 'productionLog',
      op: 'create',
      payload: { occurredAt, flockId: GROUP, kind: 'fibre', amount: 3_000, unit: 'g' },
    });

    const today = await produceToday();
    expect(today.get(`${GROUP}:milk`)?.unit).toBe('ml');
    expect(today.get(`${GROUP}:fibre`)?.unit).toBe('g');
  });

  it('totals losses without touching the head count', async () => {
    await enqueue({
      entity: 'mortality',
      op: 'create',
      payload: { occurredAt: T0, flockId: GROUP, count: 2, cause: 'predator' },
    });
    await enqueue({
      entity: 'mortality',
      op: 'create',
      payload: { occurredAt: T0 + DAY, flockId: GROUP, count: 1, cause: 'illness' },
    });

    expect((await lossesByGroup()).get(GROUP)).toBe(3);
  });

  it('remembers the most recent feed', async () => {
    await enqueue({
      entity: 'feedLog',
      op: 'create',
      payload: { occurredAt: T0, flockId: GROUP, amountGrams: 900 },
    });
    await enqueue({
      entity: 'feedLog',
      op: 'create',
      payload: { occurredAt: T0 - DAY, flockId: GROUP, amountGrams: 900 },
    });

    expect((await lastFedByGroup()).get(GROUP)).toBe(T0);
  });
});

describe('weights and named animals', () => {
  it('keeps the series and reports the latest per subject', async () => {
    for (const [occurredAt, massUg] of [
      [T0, 2_000_000_000],
      [T0 + 14 * DAY, 2_600_000_000],
    ] as const) {
      await enqueue({
        entity: 'weight',
        op: 'create',
        targetId: newId(),
        payload: { occurredAt, massUg, flockId: GROUP, sampled: true },
      });
    }

    const weights = await listWeights();
    // Append-only: the first weighing is still there.
    expect(weights).toHaveLength(2);
    expect(latestWeightBySubject(weights).get(GROUP)?.massUg).toBe(2_600_000_000);
  });

  it('offers unknown-sex animals as possible dams', async () => {
    await enqueue({
      entity: 'animal',
      op: 'create',
      targetId: newId(),
      payload: { flockId: GROUP, name: 'Bramble', species: 'goat', sex: 'unknown' },
    });
    await enqueue({
      entity: 'animal',
      op: 'create',
      targetId: newId(),
      payload: { flockId: GROUP, name: 'The buck', species: 'goat', sex: 'male' },
    });

    // A keeper who has not filled the field in still knows which goat is in
    // kid; hiding her would make the field a prerequisite.
    expect(possibleDams(await listAnimals()).map((a) => a.name)).toEqual(['Bramble']);
  });
});
