import { describe, expect, it } from 'vitest';
import {
  birthDue,
  candlingDay,
  type Due,
  growingDues,
  incubationDues,
  type MachineRecord,
  type PlantingRecord,
  projectReading,
  rotationConflict,
  serviceDue,
  storageDue,
  todayList,
  urgencyOf,
  withdrawalDue,
} from '@steading/contracts';

/**
 * The due engine.
 *
 * Two failure modes are worth more than the rest put together, and most of
 * these tests are about one or the other:
 *
 * - **A row nothing can clear.** It sits on Today forever, and a list with a
 *   permanent resident is a list people stop reading. Every builder here
 *   returns null or nothing rather than an unclearable row.
 * - **A row that should have cleared and did not.** The clearing mechanism is
 *   that the event was logged and the recomputation no longer produces the
 *   row — there is no completion flag — so each builder is tested with the
 *   event present and absent.
 */

const DAY = 86_400_000;
const NOW = Date.parse('2026-05-15T09:00:00Z');

const due = (over: Partial<Due> = {}): Due => ({
  key: 'k',
  kind: 'task',
  subject: { entity: 'task', id: 'x' },
  title: 't',
  at: NOW + 10 * DAY,
  atReading: null,
  projectedAt: null,
  noticeDays: 3,
  ...over,
});

describe('urgency', () => {
  it('is later until notice begins, then soon', () => {
    expect(urgencyOf(due({ at: NOW + 10 * DAY }), NOW)).toBe('later');
    expect(urgencyOf(due({ at: NOW + 3 * DAY }), NOW)).toBe('soon');
    expect(urgencyOf(due({ at: NOW + 1 * DAY }), NOW)).toBe('soon');
  });

  /**
   * The day it lands is 'now', not 'overdue'. Flipping at one minute past
   * midnight calls a farmer late for something they are about to do after
   * breakfast.
   */
  it('is now on the day, and overdue only after it', () => {
    expect(urgencyOf(due({ at: NOW }), NOW)).toBe('now');
    expect(urgencyOf(due({ at: NOW - DAY + 1 }), NOW)).toBe('now');
    expect(urgencyOf(due({ at: NOW - DAY - 1 }), NOW)).toBe('overdue');
  });

  /** A meter row with no usage estimate must never claim to be due. */
  it('stays later when a meter row cannot be projected', () => {
    const meter = due({ at: null, atReading: 250, projectedAt: null, noticeDays: 21 });
    expect(urgencyOf(meter, NOW)).toBe('later');
    expect(todayList([meter], NOW)).toEqual([]);
  });
});

describe('todayList', () => {
  it('shows overdue first, then soonest, and hides what is still far off', () => {
    const rows = [
      due({ key: 'far', at: NOW + 60 * DAY }),
      due({ key: 'soon', at: NOW + 2 * DAY }),
      due({ key: 'late', at: NOW - 9 * DAY }),
      due({ key: 'today', at: NOW }),
    ];

    expect(todayList(rows, NOW).map((d) => d.key)).toEqual(['late', 'today', 'soon']);
  });

  /**
   * Two rows on the same day must not swap between renders — to someone
   * glancing at a phone in a barn, a reordering list looks like a change.
   */
  it('breaks ties stably', () => {
    const a = due({ key: 'aaa', at: NOW });
    const b = due({ key: 'bbb', at: NOW });
    expect(todayList([b, a], NOW).map((d) => d.key)).toEqual(['aaa', 'bbb']);
    expect(todayList([a, b], NOW).map((d) => d.key)).toEqual(['aaa', 'bbb']);
  });
});

describe('growing', () => {
  const names = { variety: 'Sungold', bed: 'Bed 3' };

  const planting = (over: Partial<PlantingRecord> = {}): PlantingRecord => ({
    id: 'p1',
    bedId: 'b1',
    varietyId: 'v1',
    status: 'planned',
    plannedStartIndoorsAt: NOW - 40 * DAY,
    plannedTransplantAt: NOW + 14 * DAY,
    plannedFirstHarvestAt: NOW + 89 * DAY,
    ...over,
  });

  it('raises the stages that have not happened', () => {
    const kinds = growingDues(planting(), names).map((d) => d.kind);
    expect(kinds).toContain('start-indoors');
    expect(kinds).toContain('harvest');
  });

  /** The whole clearing mechanism: the event exists, so the row is not built. */
  it('stops raising a stage once its event is logged', () => {
    const started = growingDues(planting({ startedIndoorsAt: NOW - 39 * DAY }), names);
    expect(started.map((d) => d.kind)).not.toContain('start-indoors');
  });

  /**
   * A row telling someone to transplant an empty tray is the app being
   * confidently wrong about the state of their propagator.
   */
  it('withholds transplant until the seedlings were actually started', () => {
    expect(growingDues(planting(), names).map((d) => d.kind)).not.toContain('transplant');

    const started = growingDues(planting({ startedIndoorsAt: NOW - 39 * DAY }), names);
    expect(started.map((d) => d.kind)).toContain('transplant');
  });

  /**
   * A planting that died in May must not spend the summer asking to be
   * harvested. Noise is how a farmer learns to ignore the row that mattered.
   */
  it('produces nothing for a finished, failed, or lifted planting', () => {
    expect(growingDues(planting({ status: 'failed' }), names)).toEqual([]);
    expect(growingDues(planting({ status: 'finished' }), names)).toEqual([]);
    expect(growingDues(planting({ removedAt: NOW }), names)).toEqual([]);
  });

  it('says what to do, in the farm’s own words', () => {
    const sow = growingDues(
      planting({ plannedStartIndoorsAt: undefined, plannedSowAt: NOW + 3 * DAY }),
      names,
    ).find((d) => d.kind === 'sow');

    expect(sow?.title).toBe('Sow Sungold in Bed 3');
  });
});

describe('rotation', () => {
  const history = [
    { season: 2024, family: 'brassica' },
    { season: 2025, family: 'legume' },
  ];

  it('flags a family returning inside the rotation window', () => {
    expect(rotationConflict('brassica', history, 2026, 3)).toBe(2024);
  });

  it('clears once the window has passed', () => {
    expect(rotationConflict('brassica', history, 2028, 3)).toBeNull();
  });

  /** A farm with too few beds turns it off rather than being nagged. */
  it('is silent when rotation is disabled', () => {
    expect(rotationConflict('brassica', history, 2026, 0)).toBeNull();
  });
});

describe('service', () => {
  const machine = (over: Partial<MachineRecord> = {}): MachineRecord => ({
    id: 'm1',
    name: 'Kubota',
    hasHourMeter: true,
    hours: 900,
    usagePerDay: 2,
    ...over,
  });

  it('targets the next multiple past the last service, and projects a date', () => {
    const row = serviceDue(machine(), { id: 's1', name: 'Oil change', everyHours: 250, lastDoneAtHours: 750 }, NOW);

    expect(row?.atReading).toBe(1000);
    // 100 hours to go at 2 h/day.
    expect(row?.projectedAt).toBe(NOW + 50 * DAY);
  });

  /**
   * A machine bought at 900 hours with no service history is overdue, and the
   * honest answer is to say so rather than restart the clock at 1150.
   */
  it('counts from zero when nothing was ever recorded', () => {
    const row = serviceDue(machine(), { id: 's1', name: 'Oil change', everyHours: 250 }, NOW);
    expect(row?.atReading).toBe(250);
    expect(row?.projectedAt).toBe(NOW);
    expect(urgencyOf(row as Due, NOW)).toBe('now');
  });

  /** Rather than a row nothing can clear. */
  it('returns nothing for an hours interval on a machine with no meter', () => {
    expect(serviceDue(machine({ hasHourMeter: false, hours: null }), { id: 's', name: 'x', everyHours: 250 }, NOW)).toBeNull();
    expect(serviceDue(machine({ hours: null }), { id: 's', name: 'x', everyHours: 250 }, NOW)).toBeNull();
  });

  it('leaves a meter row undated when usage is unknown', () => {
    const row = serviceDue(machine({ usagePerDay: null }), { id: 's', name: 'x', everyHours: 250 }, NOW);
    expect(row?.atReading).toBe(250);
    expect(row?.projectedAt).toBeNull();
  });

  it('handles a date interval, and treats no history as due now', () => {
    const serviced = serviceDue(machine(), { id: 's', name: 'Grease', everyDays: 30, lastDoneAt: NOW - 10 * DAY }, NOW);
    expect(serviced?.at).toBe(NOW + 20 * DAY);

    const never = serviceDue(machine(), { id: 's', name: 'Grease', everyDays: 30 }, NOW);
    expect(never?.at).toBe(NOW);
  });

  /**
   * The reason `projectedAt` exists: the morning list does not sort itself by
   * module, so an hours-based service has to order against a sow date.
   */
  it('sorts a projected meter row against a dated one', () => {
    const service = serviceDue(machine(), { id: 's1', name: 'Oil change', everyHours: 250, lastDoneAtHours: 890 }, NOW);
    const sow = due({ key: 'sow', kind: 'sow', at: NOW + 12 * DAY, noticeDays: 14 });

    // 240 hours from 900 to 1140, at 2 h/day, is 120 days out — well after the sow.
    expect(todayList([service as Due, sow], NOW).map((d) => d.key)).toEqual(['sow']);
  });
});

describe('projectReading', () => {
  it('returns now when the target is already passed', () => {
    expect(projectReading(300, 2, 250, NOW)).toBe(NOW);
  });

  it('refuses to guess without a usable rate', () => {
    expect(projectReading(100, null, 250, NOW)).toBeNull();
    expect(projectReading(100, 0, 250, NOW)).toBeNull();
    expect(projectReading(100, -1, 250, NOW)).toBeNull();
  });
});

describe('storage', () => {
  const machine: MachineRecord = { id: 'm1', name: 'Mower', hasHourMeter: false, hours: null, usagePerDay: null };
  const putAway = Date.parse('2026-11-01T00:00:00Z');

  it('raises a put-away row and clears it once it is done', () => {
    expect(storageDue(machine, putAway, undefined, NOW)?.kind).toBe('storage');
    expect(storageDue(machine, putAway, putAway + DAY, NOW)).toBeNull();
  });

  /** A mower left out through November is the row that must not vanish. */
  it('keeps showing when overdue', () => {
    const late = Date.parse('2026-12-01T00:00:00Z');
    const row = storageDue(machine, putAway, undefined, late) as Due;
    expect(urgencyOf(row, late)).toBe('overdue');
  });
});

describe('livestock', () => {
  it('turns an active withdrawal into a row that says when it ends', () => {
    const row = withdrawalDue(
      { kind: 'egg', medicationId: 'med1', medication: 'Baytril', subjectId: 'f1', clearsAt: NOW + 4 * DAY },
      'Layers',
    );

    expect(row.at).toBe(NOW + 4 * DAY);
    // Not actionable early: the produce is already being held.
    expect(row.noticeDays).toBe(0);
    expect(urgencyOf(row, NOW)).toBe('later');
  });

  it('raises candling then hatch, and drops each as it is logged', () => {
    const set = { id: 'i1', species: 'chicken', setAt: NOW };

    expect(incubationDues(set, 'Buff Orpington').map((d) => d.kind)).toEqual(['candle', 'hatch']);
    expect(incubationDues({ ...set, candledAt: NOW + 7 * DAY }, 'x').map((d) => d.kind)).toEqual(['hatch']);
    expect(incubationDues({ ...set, hatchedAt: NOW + 21 * DAY }, 'x')).toEqual([]);
  });

  it('dates a hatch from the species, not from a guess', () => {
    const hatch = incubationDues({ id: 'i1', species: 'duck', setAt: NOW }, 'Runners').find((d) => d.kind === 'hatch');
    expect(hatch?.at).toBe(NOW + 28 * DAY);

    // A species with no incubation period raises nothing rather than inventing one.
    expect(incubationDues({ id: 'i2', species: 'goat', setAt: NOW }, 'x')).toEqual([]);
  });

  it('candles about a third of the way in, never before day five', () => {
    expect(candlingDay(21)).toBe(7);
    expect(candlingDay(18)).toBe(6);
    expect(candlingDay(52)).toBe(17);
  });

  /** Six weeks, because a pen has to be built and someone has to be around. */
  it('gives a birth six weeks of notice and clears it when the kid arrives', () => {
    const bred = { id: 'br1', species: 'goat', damId: 'a1', bredAt: NOW };
    const row = birthDue(bred, 'Willow') as Due;

    expect(row.at).toBe(NOW + 150 * DAY);
    expect(row.noticeDays).toBe(42);
    expect(urgencyOf(row, NOW + 120 * DAY)).toBe('soon');

    expect(birthDue({ ...bred, bornAt: NOW + 149 * DAY }, 'Willow')).toBeNull();
  });
});
