import { describe, expect, it } from 'vitest';
import {
  careDues,
  careIntervalDays,
  careLogCreateSchema,
  type Due,
  partsDue,
  partsNote,
  partsState,
  urgencyOf,
} from '@homefarm/contracts';

/**
 * Routine husbandry, and whether the part is on the shelf.
 *
 * Two small features that finish two domains, and both turn on the same
 * judgement: **what should the app do when it does not know?** A job never
 * recorded, a service with no parts linked. Getting that wrong in either
 * direction produces a list nobody reads.
 */

const DAY = 86_400_000;
const NOW = Date.parse('2026-05-15T09:00:00Z');

describe('care intervals', () => {
  /** Hooves grow at the same rate on a goat and a sheep, and neither is a hen. */
  it('answers from the species group', () => {
    expect(careIntervalDays('goat', 'hoof-trim')).toBe(56);
    expect(careIntervalDays('sheep', 'hoof-trim')).toBe(56);
    expect(careIntervalDays('chicken', 'hoof-trim')).toBeNull();
  });

  it('lets a species disagree with its group where it genuinely does', () => {
    // Cattle feet are trimmed far less often than a goat's.
    expect(careIntervalDays('cattle', 'hoof-trim')).toBe(182);
    // A horse goes lame quickly, and has teeth nothing else on the list has.
    expect(careIntervalDays('horse', 'hoof-trim')).toBe(42);
    expect(careIntervalDays('horse', 'dental')).toBe(365);
    expect(careIntervalDays('goat', 'dental')).toBeNull();
  });

  it('does not offer minerals to poultry', () => {
    expect(careIntervalDays('chicken', 'mineral')).toBeNull();
    expect(careIntervalDays('goat', 'mineral')).toBe(30);
  });
});

describe('care dues', () => {
  const goats = {
    id: 'f1',
    name: 'Nubians',
    species: 'goat' as const,
    lastDone: { 'hoof-trim': NOW - 50 * DAY, worming: NOW - 10 * DAY },
  };

  it('counts from the last time the job was done', () => {
    const trim = careDues(goats, NOW).find((d) => d.key.endsWith('hoof-trim')) as Due;
    expect(trim.at).toBe(NOW - 50 * DAY + 56 * DAY);
    expect(urgencyOf(trim, NOW)).toBe('soon');
  });

  /**
   * The judgement call, and it now has a week in it.
   *
   * A farm that has never recorded trimming either is not trimming or is not
   * recording it, and both are worth a row — starting the clock at one full
   * interval would tell someone their overdue herd is fine for another eight
   * weeks. That half is unchanged.
   *
   * What changed is the first morning. Every job for every new group being due
   * the instant it was created meant adding three groups on a Sunday produced
   * a wall of overdue rows on Monday, which is what people close an app to get
   * away from. A week is short enough that a genuine backlog still surfaces in
   * the first week rather than the first season.
   */
  it('treats a job never recorded as due a week out, not one interval out', () => {
    const mineral = careDues(goats, NOW).find((d) => d.key.endsWith('mineral')) as Due;

    expect(mineral.at).toBe(NOW + 7 * 86_400_000);
    // Well short of the 30-day interval it would otherwise have waited.
    expect(mineral.at).toBeLessThan(NOW + 30 * 86_400_000);
    // Still on Today, because the notice window is a fortnight.
    expect(urgencyOf(mineral, NOW)).toBe('soon');
  });

  /** A group the farm has had for a while is past its grace and asks now. */
  it('does not give a group added last year a week of quiet', () => {
    const settled = { ...goats, since: NOW - 365 * 86_400_000 };
    const mineral = careDues(settled, NOW).find((d) => d.key.endsWith('mineral')) as Due;

    expect(urgencyOf(mineral, NOW)).toBe('overdue');
  });

  it('raises nothing for jobs the species does not have', () => {
    const keys = careDues(goats, NOW).map((d) => d.key);
    expect(keys.some((k) => k.endsWith('dental'))).toBe(false);

    const hens = { id: 'f2', name: 'Layers', species: 'chicken' as const, lastDone: {} };
    expect(careDues(hens, NOW).some((d) => d.key.endsWith('hoof-trim'))).toBe(false);
  });

  /** A farm that trims every twelve weeks sets twelve and stops thinking. */
  it('lets a farm override an interval', () => {
    const slower = careDues({ ...goats, intervals: { 'hoof-trim': 84 } }, NOW);
    const trim = slower.find((d) => d.key.endsWith('hoof-trim')) as Due;
    expect(trim.at).toBe(NOW - 50 * DAY + 84 * DAY);
  });

  /** And a farm that does not do a job at all silences it outright. */
  it('lets a farm silence a job', () => {
    const quiet = careDues({ ...goats, intervals: { vaccination: null } }, NOW);
    expect(quiet.some((d) => d.key.endsWith('vaccination'))).toBe(false);
  });

  it('names the group, so a row is actionable without opening it', () => {
    const trim = careDues(goats, NOW).find((d) => d.key.endsWith('hoof-trim')) as Due;
    expect(trim.title).toBe('Trim feet — Nubians');
  });
});

describe('care log', () => {
  it('belongs to exactly one animal or one group', () => {
    const base = { occurredAt: NOW, kind: 'worming' as const };
    expect(careLogCreateSchema.safeParse({ ...base, flockId: 'A'.repeat(26) }).success).toBe(true);
    expect(careLogCreateSchema.safeParse(base).success).toBe(false);
    expect(
      careLogCreateSchema.safeParse({ ...base, flockId: 'A'.repeat(26), animalId: 'B'.repeat(26) })
        .success,
    ).toBe(false);
  });

  /** A wormer brand is not a medication record, and forcing one would mean
      either a fake medication row or nothing recorded at all. */
  it('takes a free-text product without demanding a medication record', () => {
    expect(
      careLogCreateSchema.safeParse({
        occurredAt: NOW,
        kind: 'worming',
        flockId: 'A'.repeat(26),
        product: 'Ivermectin drench',
        animalsTreated: 12,
      }).success,
    ).toBe(true);
  });
});

describe('parts', () => {
  const service: Due = {
    key: 'm1:service:s1',
    kind: 'service',
    subject: { entity: 'equipment', id: 'm1' },
    title: 'Oil change on Kubota',
    at: NOW + 30 * DAY,
    atReading: null,
    projectedAt: null,
    noticeDays: 21,
  };

  it('knows the shelf can cover it', () => {
    expect(partsState([{ id: 'p1', name: 'Oil filter', quantity: 2 }])).toBe('stocked');
    expect(partsState([{ id: 'p1', name: 'Oil filter', quantity: 0 }])).toBe('short');
  });

  /**
   * A farm that has not linked its filters is not a farm that is short of
   * filters. Unknown must never read as a problem.
   */
  it('says unknown when nothing is linked, and raises no row', () => {
    expect(partsState([])).toBe('unknown');
    expect(partsDue(service, [])).toBeNull();
    expect(partsNote([])).toBeNull();
  });

  /**
   * The arithmetic the feature exists for: a part ordered the day a service
   * falls due is a part that arrives after it.
   */
  it('dates the order ahead of the service by its lead time', () => {
    const row = partsDue(service, [{ id: 'p1', name: 'Oil filter', quantity: 0 }], 21) as Due;
    expect(row.at).toBe(NOW + 30 * DAY - 21 * DAY);
    expect(row.title).toBe('Order Oil filter for oil change on kubota');
  });

  it('raises nothing when the shelf is stocked', () => {
    expect(partsDue(service, [{ id: 'p1', name: 'Oil filter', quantity: 1 }])).toBeNull();
  });

  /** A row nothing can clear is worse than no row. */
  it('raises nothing for a service with no date to count back from', () => {
    const undated: Due = { ...service, at: null, atReading: 1000, projectedAt: null };
    expect(partsDue(undated, [{ id: 'p1', name: 'Oil filter', quantity: 0 }])).toBeNull();
  });

  it('counts multiples, and says how many short', () => {
    expect(partsState([{ id: 'p1', name: 'Blade', quantity: 1, needed: 3 }])).toBe('short');
    expect(partsNote([{ id: 'p1', name: 'Blade', quantity: 1, needed: 3 }])).toBe(
      'Not on the shelf: Blade (2 more).',
    );
  });

  /** The answer to "which?" is the only reason anyone reads the note. */
  it('names what is missing rather than saying parts are short', () => {
    const note = partsNote([
      { id: 'p1', name: 'Oil filter', quantity: 0 },
      { id: 'p2', name: 'Air filter', quantity: 4 },
      { id: 'p3', name: 'Fuel filter', quantity: 0 },
    ]);
    expect(note).toBe('Not on the shelf: Oil filter, Fuel filter.');
  });
});
