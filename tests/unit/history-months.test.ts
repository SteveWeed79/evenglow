import { describe, expect, it } from 'vitest';
import { intoDays, intoMonths, type HistoryEvent } from '@homefarm/core/read/history';

/**
 * What happened, gathered into months.
 *
 * Reported as a question and it was the right one: *"Should the What happened
 * screen collapse by month > day > stuff that happened?"*
 *
 * A flat list of days grows without bound and there is no year at which it
 * stops. By a second season a farm looking for last April is scrolling past
 * three hundred headings, and the screen holding everything the farm knows
 * becomes the one nobody opens.
 *
 * The screen's answer had been a thirty-day cap with a "show all" button under
 * it, which is the shape of the problem rather than a fix: the cure for a list
 * too long to read is not a button that makes it longer.
 */

const at = (year: number, month: number, day: number, hour = 9): number =>
  new Date(year, month, day, hour).getTime();

const egg = (when: number, count: number, id = `e${when}${count}`): HistoryEvent => ({
  id,
  entity: 'eggLog',
  at: when,
  title: `${count} eggs`,
  removable: true,
  tally: { key: 'eggs', amount: count, unit: 'egg' },
});

describe('gathering', () => {
  it('puts the days of one month together', () => {
    const days = intoDays([egg(at(2026, 7, 1), 3), egg(at(2026, 7, 14), 4)], 'metric');

    const months = intoMonths(days, 'metric');

    expect(months).toHaveLength(1);
    expect(months[0]?.days).toHaveLength(2);
  });

  it('keeps two months apart', () => {
    const days = intoDays([egg(at(2026, 7, 1), 3), egg(at(2026, 6, 30), 4)], 'metric');

    const months = intoMonths(days, 'metric');

    expect(months).toHaveLength(2);
  });

  /** The same month a year apart is not the same month. */
  it('keeps one August from another', () => {
    const days = intoDays([egg(at(2026, 7, 3), 3), egg(at(2025, 7, 3), 4)], 'metric');

    expect(intoMonths(days, 'metric')).toHaveLength(2);
  });

  it('puts the newest first, like everything else on this screen', () => {
    const days = intoDays(
      [egg(at(2026, 5, 1), 1), egg(at(2026, 7, 1), 1), egg(at(2026, 6, 1), 1)],
      'metric',
    );

    const months = intoMonths(days, 'metric').map((m) => new Date(m.month).getMonth());

    expect(months).toEqual([7, 6, 5]);
  });

  it('keeps the days inside a month newest first too', () => {
    const days = intoDays(
      [egg(at(2026, 7, 2), 1), egg(at(2026, 7, 20), 1), egg(at(2026, 7, 11), 1)],
      'metric',
    );

    const dates = intoMonths(days, 'metric')[0]?.days.map((d) => new Date(d.day).getDate());

    expect(dates).toEqual([20, 11, 2]);
  });

  /** The heading is the first of the month at local midnight, whatever hour the
      events in it happened at. */
  it('keys a month on its first day', () => {
    const days = intoDays([egg(at(2026, 7, 23, 22), 1)], 'metric');

    const month = intoMonths(days, 'metric')[0]?.month;

    expect(new Date(month ?? 0).getDate()).toBe(1);
    expect(new Date(month ?? 0).getHours()).toBe(0);
  });
});

describe('the line a closed month shows', () => {
  /**
   * Built by the same `summarise` the days use, over a wider window. Two
   * definitions of what a total means would drift the first time a tally unit
   * changed.
   */
  it('adds the whole month up', () => {
    const days = intoDays(
      [egg(at(2026, 7, 1), 10), egg(at(2026, 7, 2), 12), egg(at(2026, 7, 30), 8)],
      'metric',
    );

    expect(intoMonths(days, 'metric')[0]?.summary).toContain('30');
  });

  it('counts only the days that had something', () => {
    const days = intoDays([egg(at(2026, 7, 1), 1), egg(at(2026, 7, 9), 1)], 'metric');

    // Two, not thirty-one. An empty day is not a day the farm did nothing on
    // record — it is a day with no record, and there is nothing to open.
    expect(intoMonths(days, 'metric')[0]?.active).toBe(2);
  });

  it('says nothing about a month it was not given', () => {
    expect(intoMonths([], 'metric')).toEqual([]);
  });
});
