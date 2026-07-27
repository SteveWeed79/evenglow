import { describe, expect, it } from 'vitest';
import { daysUntilDue, usagePerDay } from '@/client/read/iron';

const DAY = 86_400_000;
const T0 = new Date('2026-07-01T08:00:00Z').getTime();

describe('usage-rate forecasting (W5)', () => {
  it('needs two readings before it will guess', () => {
    expect(usagePerDay([])).toBeNull();
    expect(usagePerDay([{ occurredAt: T0, hours: 412 }])).toBeNull();
  });

  it('averages across the whole series, not the last pair', () => {
    // Idle for a fortnight then run hard for a day should read as the
    // average, not as the last day's burst.
    const readings = [
      { occurredAt: T0, hours: 400 },
      { occurredAt: T0 + 13 * DAY, hours: 400 },
      { occurredAt: T0 + 14 * DAY, hours: 414 },
    ];
    expect(usagePerDay(readings)).toBeCloseTo(1, 5);
  });

  it('handles readings arriving out of order', () => {
    const readings = [
      { occurredAt: T0 + 10 * DAY, hours: 426 },
      { occurredAt: T0, hours: 406 },
    ];
    expect(usagePerDay(readings)).toBeCloseTo(2, 5);
  });

  it('refuses to report a negative rate', () => {
    // A meter that went backwards is bad data, not negative usage.
    const readings = [
      { occurredAt: T0, hours: 500 },
      { occurredAt: T0 + DAY, hours: 400 },
    ];
    expect(usagePerDay(readings)).toBeNull();
  });

  it('refuses when two readings share a timestamp', () => {
    const readings = [
      { occurredAt: T0, hours: 400 },
      { occurredAt: T0, hours: 410 },
    ];
    expect(usagePerDay(readings)).toBeNull();
  });
});

describe('days until due', () => {
  it('gives the number that lets a filter be ordered in time', () => {
    // "Due in about 9 days at 1.4 h/day", not just "overdue".
    expect(daysUntilDue(237.4, 250, 1.4)).toBeCloseTo(9, 0);
  });

  it('is null when the rate is unknown', () => {
    expect(daysUntilDue(100, 250, null)).toBeNull();
  });

  it('is null for a machine that never runs, rather than infinity', () => {
    expect(daysUntilDue(100, 250, 0)).toBeNull();
  });

  it('clamps an overdue service to zero rather than going negative', () => {
    expect(daysUntilDue(300, 250, 1.4)).toBe(0);
  });
});
