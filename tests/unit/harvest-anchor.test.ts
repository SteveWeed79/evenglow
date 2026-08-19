import { describe, expect, it } from 'vitest';
import { growingDues, type PlantingNames, type PlantingRecord } from '@homefarm/contracts';

/**
 * When a harvest is due, counted from the day it went in the ground.
 *
 * ## The report
 *
 * *"I told the app I put a pumpkin crop in the ground today and it's telling me
 * it should have been harvested 15 days ago."*
 *
 * `plannedFirstHarvestAt` is computed once, when the planting is created, from
 * the site's frost dates — sow so many weeks after last frost, add days to
 * maturity. That is a forecast for something not yet planted, and it was the
 * only field the harvest row ever looked at. Plant in August and the forecast
 * for a spring sowing is already behind you, so the app announces an overdue
 * harvest for a seed that went in this morning.
 *
 * A plant does not know what the schedule said. It takes its days from the day
 * it was sown or set out.
 *
 * ## The order of the anchor
 *
 * `transplantedAt` before `sownAt`, which is also how seed catalogues count:
 * days to maturity runs from transplant for a crop raised indoors and from
 * sowing for one direct sown. Getting that backwards would put a tomato's
 * harvest six weeks early.
 *
 * This is the rule the transplant row already followed and stated out loud —
 * a stage waits on what actually happened, not on what was predicted. Harvest
 * never got it.
 */

const DAY = 24 * 60 * 60 * 1000;
const AUGUST = Date.UTC(2026, 7, 13);
/** What a spring schedule would have predicted, and it is in the past. */
const PLANNED_BACK_IN_JULY = Date.UTC(2026, 6, 29);

function planting(over: Partial<PlantingRecord> = {}): PlantingRecord {
  return {
    id: '01J00000000000000000000P1',
    bedId: '01J00000000000000000000B1',
    varietyId: '01J00000000000000000000V1',
    status: 'in-ground',
    plannedFirstHarvestAt: PLANNED_BACK_IN_JULY,
    ...over,
  };
}

const NAMES: PlantingNames = { variety: 'Black Pumpkin', bed: 'The top bed', daysToMaturity: 100 };

function harvestOf(
  record: PlantingRecord,
  names: PlantingNames = NAMES,
): number | null | undefined {
  return growingDues(record, names).find((due) => due.kind === 'harvest')?.at;
}

describe('a crop put in the ground today', () => {
  /** The reported failure, exactly. */
  it('is not already overdue to harvest', () => {
    const at = harvestOf(planting({ sownAt: AUGUST }));

    expect(at).toBe(AUGUST + 100 * DAY);
    expect(at, 'harvest is in the past for something sown today').toBeGreaterThan(AUGUST);
  });

  it('counts from the transplant when there was one', () => {
    const at = harvestOf(
      planting({ sownAt: Date.UTC(2026, 5, 1), transplantedAt: AUGUST }),
    );

    // From the transplant, not from the sowing ten weeks earlier — which is
    // how days to maturity is counted for anything raised indoors.
    expect(at).toBe(AUGUST + 100 * DAY);
  });

  it('counts from the sowing when it was direct sown', () => {
    expect(harvestOf(planting({ sownAt: AUGUST }))).toBe(AUGUST + 100 * DAY);
  });
});

describe('what still uses the planned date', () => {
  /**
   * Nothing has gone in yet, so the forecast is the only estimate there is —
   * and it is a real one, computed from the site's own frost dates.
   */
  it('keeps the forecast for a planting not yet sown', () => {
    expect(harvestOf(planting())).toBe(PLANNED_BACK_IN_JULY);
  });

  /**
   * A farm's own variety with no days to maturity filled in. A rough row beats
   * no row, so the planned date stands rather than the harvest vanishing.
   */
  it('keeps the forecast when the variety has no days to maturity', () => {
    const at = harvestOf(planting({ sownAt: AUGUST }), {
      variety: 'Something of my own',
      bed: 'The top bed',
    });

    expect(at).toBe(PLANNED_BACK_IN_JULY);
  });

  /** No planned date and nothing to compute from is no row, not a wrong one. */
  it('produces no harvest row when there is nothing to go on', () => {
    const bare = planting({ plannedFirstHarvestAt: undefined });

    expect(harvestOf(bare, { variety: 'x', bed: 'y' })).toBeUndefined();
  });
});

describe('what this must not have disturbed', () => {
  it('still clears the harvest row once picking has started', () => {
    expect(harvestOf(planting({ sownAt: AUGUST, status: 'harvesting' }))).toBeUndefined();
  });

  it('still produces nothing for a planting that failed', () => {
    expect(growingDues(planting({ sownAt: AUGUST, status: 'failed' }), NAMES)).toEqual([]);
  });

  it('still produces nothing once removed', () => {
    expect(
      growingDues(planting({ sownAt: AUGUST, removedAt: AUGUST }), NAMES),
    ).toEqual([]);
  });
});

/**
 * The other half of the same report: *"when I push In-Ground on a plant, Sowed
 * it should automatically check itself off."*
 *
 * A direct-sown crop was offered both "Sowed it" and "Planted it out", because
 * the button's gate was missing the half the due builder has — `add` returns
 * early on an absent `plannedTransplantAt`, and the screen never asked. Pressing
 * the wrong one recorded a transplant that never happened and left the sowing
 * unrecorded, so the sow row went on asking over a bed with a plant in it.
 *
 * Settled here rather than by rewriting anyone's records: a thing that has been
 * planted out is not waiting to be sown, whichever field says it is in.
 */
describe('a planting that is already in the ground', () => {
  it('is not still waiting to be sown', () => {
    const rows = growingDues(
      planting({ plannedSowAt: PLANNED_BACK_IN_JULY, transplantedAt: AUGUST }),
      NAMES,
    );

    expect(rows.map((r) => r.kind)).not.toContain('sow');
  });

  it('still asks for a sowing when nothing has gone in', () => {
    const rows = growingDues(planting({ plannedSowAt: PLANNED_BACK_IN_JULY }), NAMES);

    expect(rows.map((r) => r.kind)).toContain('sow');
  });

  /** The ordinary direct-sown case, unchanged. */
  it('clears the sow row on its own sowing as it always did', () => {
    const rows = growingDues(
      planting({ plannedSowAt: PLANNED_BACK_IN_JULY, sownAt: AUGUST }),
      NAMES,
    );

    expect(rows.map((r) => r.kind)).not.toContain('sow');
  });
});
