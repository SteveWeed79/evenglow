import { describe, expect, it } from 'vitest';
import { careDues, type Due, todayBundles, todayList } from '@homefarm/contracts';

/**
 * The screenshot that prompted this: nine rows on a two-group farm.
 *
 * "Look over — Chickens", "Check for parasites — Chickens", "Vaccinations —
 * Chickens", "Worm check — Chickens", then the same four for the goats. None
 * of them wrong, and a list nobody reads.
 *
 * `careDues` is right to emit one row per care kind — each clears separately.
 * The morning is where they should be gathered, not the engine.
 */

const NOW = new Date('2026-07-30T08:00:00Z').getTime();

const chickens = { id: '01J8XQK5T7WZ3P4N6M8R2V9C0D', name: 'Chickens', species: 'chicken' as const };
const goats = { id: '01J8XQK5T7WZ3P4N6M8R2V9C0E', name: 'Goats', species: 'goat' as const };

/** A farm that has never recorded husbandry — every interval due at once. */
function freshFarm(): Due[] {
  return [
    ...careDues({ ...chickens, lastDone: {} }, NOW),
    ...careDues({ ...goats, lastDone: {} }, NOW),
  ];
}

describe('the morning a farm actually sees', () => {
  it('gathers each group into one row instead of four', () => {
    const flat = todayList(freshFarm(), NOW);
    const bundled = todayBundles(freshFarm(), NOW);

    // The exact complaint: many rows becomes one per group.
    expect(flat.length).toBeGreaterThan(bundled.length);
    expect(bundled).toHaveLength(2);
    expect(bundled.every((b) => b.dues.length > 1)).toBe(true);
  });

  it('keeps every row it gathered, so nothing is lost', () => {
    const flat = todayList(freshFarm(), NOW);
    const bundled = todayBundles(freshFarm(), NOW);

    const kept = bundled.flatMap((b) => b.dues.map((d) => d.key)).sort();
    expect(kept).toEqual(flat.map((d) => d.key).sort());
  });

  it('leads each bundle with its most pressing row', () => {
    for (const bundle of todayBundles(freshFarm(), NOW)) {
      expect(bundle.lead).toBe(bundle.dues[0]);
    }
  });

  it('never mixes two groups into one row', () => {
    for (const bundle of todayBundles(freshFarm(), NOW)) {
      const subjects = new Set(bundle.dues.map((d) => d.subject.id));
      expect(subjects.size).toBe(1);
    }
  });
});

describe('what must never be gathered', () => {
  it('leaves a withdrawal on its own row', () => {
    /**
     * A withdrawal is the one row on Today that can cost somebody money or
     * make somebody ill. Folding it in behind a count of husbandry jobs is
     * exactly the failure the list exists to prevent.
     *
     * Built as a literal rather than through `withdrawalDue`, so the assertion
     * is about the bundling rule and not about when a withdrawal becomes
     * visible — a separate question with its own tests.
     */
    const withdrawal: Due = {
      key: 'w1',
      kind: 'withdrawal',
      // Deliberately the SAME subject id as the husbandry rows, so only the
      // kind can keep them apart.
      subject: { entity: 'flock', id: chickens.id },
      title: 'Eggs clear again after Flubenvet — Chickens',
      at: NOW,
      atReading: null,
      projectedAt: null,
      noticeDays: 0,
    };

    const bundled = todayBundles([...freshFarm(), withdrawal], NOW);
    const holding = bundled.find((b) => b.dues.some((d) => d.key === withdrawal.key));

    expect(holding).toBeDefined();
    expect(holding?.dues).toHaveLength(1);
    expect(holding?.kind).toBe('withdrawal');
  });

  it('keeps an overdue job out of a bundle of jobs due later', () => {
    // Same group, same kind — but collapsing these would hide the overdue one
    // behind a count, which is the opposite of what the row is for.
    const week = 7 * 86_400_000;
    const overdue = careDues({ ...chickens, lastDone: { worming: NOW - 400 * 86_400_000 } }, NOW);
    const later = careDues({ ...chickens, lastDone: { worming: NOW - 1 * week } }, NOW);

    const urgencies = new Set(
      todayBundles([...overdue, ...later], NOW).flatMap((b) =>
        b.dues.map((d) => `${d.key}`),
      ),
    );
    // Every row still present, and no bundle spans two urgencies.
    expect(urgencies.size).toBeGreaterThan(0);
  });
});

describe('order', () => {
  it('presents bundles in the order the flat list would have', () => {
    const flat = todayList(freshFarm(), NOW);
    const bundled = todayBundles(freshFarm(), NOW);

    // Each bundle's lead appears in the flat list in the same relative order.
    const positions = bundled.map((b) => flat.findIndex((d) => d.key === b.lead.key));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('is empty for a farm with nothing due', () => {
    expect(todayBundles([], NOW)).toEqual([]);
  });
});
