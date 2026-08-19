import { describe, expect, it } from 'vitest';
import {
  CONDITION_WORDS,
  CONDITIONS,
  dayStart,
  degrees,
  FORECAST_STALE_MS,
  forecastFor,
  forecastSchema,
  isStale,
  roundPosition,
} from '@homefarm/contracts';

/**
 * The forecast shape, and the four decisions encoded in it.
 */

function day(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    day: dayStart(Date.now()),
    condition: 'clear',
    highDeciC: 250,
    lowDeciC: 120,
    rainChance: 0,
    rainUm: 0,
    ...over,
  };
}

describe('the position a farm gives up', () => {
  /**
   * A farm's coordinates identify a family's home. Two decimals is about a
   * kilometre — ample for weather, useless for finding a door — and the
   * rounding happens on the way IN, so nowhere in this app holds better.
   */
  it('is rounded to about a kilometre', () => {
    expect(roundPosition(44.475881, -73.212074)).toEqual({ lat: 44.48, lon: -73.21 });
  });

  it('survives a round number without gaining precision', () => {
    expect(roundPosition(45, -73)).toEqual({ lat: 45, lon: -73 });
  });

  it('rounds towards zero symmetrically, so a hemisphere is not special', () => {
    expect(roundPosition(-44.475881, 73.212074)).toEqual({ lat: -44.48, lon: 73.21 });
  });
});

describe('how old is too old', () => {
  const forecast = forecastSchema.parse({
    issuedAt: 1_000_000_000,
    now: { condition: 'clear', tempDeciC: 200 },
    days: [day()],
    hours: [],
  });

  it('is two days, judged on when the service made the run', () => {
    expect(isStale(forecast, 1_000_000_000 + FORECAST_STALE_MS - 1)).toBe(false);
    expect(isStale(forecast, 1_000_000_000 + FORECAST_STALE_MS + 1)).toBe(true);
  });
});

describe('the day a screen means by "today"', () => {
  const now = Date.parse('2026-08-03T14:00:00Z');

  it('is the entry keyed to this local midnight', () => {
    const today = day({ day: dayStart(now), highDeciC: 300 });
    const tomorrow = day({ day: dayStart(now) + 86_400_000, highDeciC: 100 });

    expect(forecastFor([today, tomorrow].map(parseDay), now)?.highDeciC).toBe(300);
  });

  /**
   * A forecast fetched last night and read this morning has yesterday at the
   * front. Showing yesterday's high beside this minute's temperature is the
   * kind of quietly wrong nobody reports and everybody stops trusting.
   */
  it('skips a stale leading day rather than showing yesterday as today', () => {
    const yesterday = day({ day: dayStart(now) - 86_400_000, highDeciC: 999 });
    const tomorrow = day({ day: dayStart(now) + 86_400_000, highDeciC: 100 });

    expect(forecastFor([yesterday, tomorrow].map(parseDay), now)?.highDeciC).toBe(100);
  });

  it('has nothing to say when every day in the list has been', () => {
    const yesterday = day({ day: dayStart(now) - 86_400_000 });
    expect(forecastFor([yesterday].map(parseDay), now)).toBeUndefined();
  });
});

function parseDay(value: Record<string, unknown>): ReturnType<typeof forecastSchema.parse>['days'][number] {
  return forecastSchema.parse({
    issuedAt: 0,
    now: { condition: 'clear', tempDeciC: 0 },
    days: [value],
    hours: [],
  }).days[0]!;
}

describe('temperature as a farm reads it', () => {
  it('is whole degrees, in the system the farm chose', () => {
    // 0°C is 32°F.
    expect(degrees(0, 'imperial')).toBe(32);
    expect(degrees(0, 'metric')).toBe(0);
    // 21.5°C is 70.7°F.
    expect(degrees(215, 'imperial')).toBe(71);
    expect(degrees(215, 'metric')).toBe(22);
  });

  it('does not produce a negative zero, which reads as a bug', () => {
    expect(Object.is(degrees(-2, 'metric'), -0)).toBe(false);
  });
});

describe('the vocabulary', () => {
  it('has a word for every sky the app can be in', () => {
    for (const condition of CONDITIONS) {
      expect(CONDITION_WORDS[condition]).toBeTruthy();
    }
  });
});

describe('the shape itself', () => {
  it('refuses a chance of rain that is not a percentage', () => {
    expect(() =>
      forecastSchema.parse({
        issuedAt: 0,
        now: { condition: 'clear', tempDeciC: 0 },
        days: [day({ rainChance: 140 })],
        hours: [],
      }),
    ).toThrow();
  });

  /** Integers throughout, like every other measure in this codebase. */
  it('refuses a fractional temperature', () => {
    expect(() =>
      forecastSchema.parse({
        issuedAt: 0,
        now: { condition: 'clear', tempDeciC: 20.5 },
        days: [],
        hours: [],
      }),
    ).toThrow();
  });

  it('reads a forecast with no hourly product as having no hours', () => {
    const parsed = forecastSchema.parse({
      issuedAt: 0,
      now: { condition: 'clear', tempDeciC: 0 },
      days: [],
    });
    expect(parsed.hours).toEqual([]);
  });
});
