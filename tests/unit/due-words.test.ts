import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Due } from '@homefarm/contracts';
import { dueWhen } from '../../apps/mobile/src/components/DueRow';

/**
 * When a row is due, in the words somebody would use.
 *
 * ## The afternoon bug
 *
 * `dueWhen` measured `(at - now)` from **this instant** against dates anchored
 * at local midnight, under a comment claiming the opposite: *"whole days from
 * the start of today, so 'tomorrow' does not become 'today' because it is late
 * in the evening."*
 *
 * So the answer moved through the day. A job due today, read at 13:00, is
 * thirteen hours behind now — −0.54 of a day, rounding to −1 — and printed
 * **"yesterday"**. A job due tomorrow, read at the same hour, is eleven hours
 * ahead: +0.46, rounding to 0, printing **"today"**. Every afternoon, on every
 * row, in both directions at once.
 *
 * Nothing tested it. These are the hours of one day, which is the shape of
 * assertion that would have caught it: a single sample at midnight passes.
 */

const DAY = 86_400_000;

/** Local midnight on a fixed date, which is where due dates are anchored. */
function midnight(daysFromBase = 0): number {
  const date = new Date(2026, 5, 10);
  date.setHours(0, 0, 0, 0);
  return date.getTime() + daysFromBase * DAY;
}

/** The same day at a given hour — when somebody is actually holding the phone. */
function at(hour: number, daysFromBase = 0): number {
  const date = new Date(midnight(daysFromBase));
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

const row = (dueAt: number): Due => ({
  key: 'k',
  kind: 'task',
  subject: { entity: 'flock', id: 'f1' },
  title: 'A job',
  at: dueAt,
  atReading: null,
  projectedAt: null,
  noticeDays: 3,
});

describe('a job due today', () => {
  /** The reported shape: correct at breakfast, wrong after lunch. */
  it('reads today at every hour of the day', () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(dueWhen(row(midnight()), at(hour)), `at ${hour}:00`).toBe('today');
    }
  });
});

describe('a job due tomorrow', () => {
  /** The other half, and the one the comment claimed to have prevented. */
  it('reads tomorrow at every hour of today', () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(dueWhen(row(midnight(1)), at(hour)), `at ${hour}:00`).toBe('tomorrow');
    }
  });
});

describe('a job that is late', () => {
  it('reads yesterday all through the following day', () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(dueWhen(row(midnight(-1)), at(hour)), `at ${hour}:00`).toBe('yesterday');
    }
  });

  it('counts the days once it is properly late', () => {
    expect(dueWhen(row(midnight(-5)), at(13))).toBe('5 days ago');
  });
});

describe('further out', () => {
  it('keeps the existing words', () => {
    expect(dueWhen(row(midnight(3)), at(13))).toBe('in 3 days');
    expect(dueWhen(row(midnight(21)), at(13))).toBe('in 3 weeks');
    expect(dueWhen(row(midnight(90)), at(13))).toBe('in 3 months');
  });

  /** A meter row has no date at all, and says the reading instead. */
  it('says the reading when there is no date', () => {
    expect(dueWhen({ ...row(0), at: null, atReading: 1000 }, at(13))).toBe('at 1000 hours');
  });
});

/**
 * The same lesson H12 taught the trend buckets: a day is not always 86,400,000
 * milliseconds, and this rounds a ratio of two local midnights precisely so it
 * survives the two mornings a year when it is not.
 */
describe('the morning the clocks change', () => {
  const WAS = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'America/New_York';
  });

  afterAll(() => {
    if (WAS === undefined) delete process.env.TZ;
    else process.env.TZ = WAS;
  });

  /** 8 March 2026 is a 23-hour day; 1 November is a 25-hour one. */
  it('still says tomorrow across a 23 and a 25 hour day', () => {
    const spring = new Date(2026, 2, 7);
    spring.setHours(0, 0, 0, 0);
    const autumn = new Date(2026, 9, 31);
    autumn.setHours(0, 0, 0, 0);

    for (const start of [spring.getTime(), autumn.getTime()]) {
      const next = new Date(start);
      next.setDate(next.getDate() + 1);
      const reading = new Date(start);
      reading.setHours(13, 0, 0, 0);

      expect(dueWhen(row(next.getTime()), reading.getTime())).toBe('tomorrow');
      expect(dueWhen(row(start), reading.getTime())).toBe('today');
    }
  });
});
