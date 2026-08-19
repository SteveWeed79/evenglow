import { describe, expect, it } from 'vitest';
import { forecastDaySchema, highLowWords, type ForecastDay } from '@homefarm/contracts';

/**
 * A forecast day is two halves, and by evening one of them has happened.
 *
 * Reported from the phone: *"under The week the weather for today shows only
 * the low? it's odd it shows 79 79."* Exactly right. NWS publishes day/night
 * periods, so a forecast fetched after dark has a night for today and no day —
 * and both fields were required, so the provider filled each from the other.
 *
 * The screen then printed a real-looking flat day. Nothing could contradict it:
 * a high equal to a low is a perfectly ordinary value, so there was no way to
 * tell a still day from a missing number.
 *
 * It was not only cosmetic either. `warnings.ts` reads `highDeciC` for heat, so
 * a warm night on a day whose daytime half had passed could raise a heat watch
 * off a figure nobody forecast as a high.
 */

const day = (over: Partial<ForecastDay>): ForecastDay =>
  forecastDaySchema.parse({
    day: Date.parse('2026-08-14T00:00:00'),
    condition: 'clear',
    highDeciC: 261,
    lowDeciC: 144,
    rainChance: 10,
    rainUm: 0,
    ...over,
  });

describe('the shape', () => {
  /** Widening a required field: a forecast cached by an older build still parses. */
  it('still accepts a day with both halves', () => {
    expect(day({}).highDeciC).toBe(261);
  });

  it('accepts a day whose daytime half has already happened', () => {
    const parsed = forecastDaySchema.safeParse({
      day: Date.parse('2026-08-14T00:00:00'),
      condition: 'clear',
      lowDeciC: 144,
      rainChance: 10,
      rainUm: 0,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.highDeciC).toBeUndefined();
  });
});

describe('saying it out loud', () => {
  it('gives both when both were forecast', () => {
    expect(highLowWords(day({ highDeciC: 261, lowDeciC: 144 }), 'imperial')).toBe(
      'High 79° · Low 58°',
    );
  });

  /**
   * The reported case. A bare "58°" beside a thermometer reads as *the*
   * temperature, so the half is named rather than left to be guessed at.
   */
  it('names the low when the day is over', () => {
    const evening = day({ lowDeciC: 144 });
    delete (evening as { highDeciC?: number }).highDeciC;

    expect(highLowWords(evening, 'imperial')).toBe('Low 58° tonight');
  });

  it('names the high when only that half is known', () => {
    const partial = day({ highDeciC: 261 });
    delete (partial as { lowDeciC?: number }).lowDeciC;

    expect(highLowWords(partial, 'imperial')).toBe('High 79°');
  });

  /** Nothing to say beats a row of dashes. */
  it('says nothing when neither half was forecast', () => {
    const blank = day({});
    delete (blank as { highDeciC?: number }).highDeciC;
    delete (blank as { lowDeciC?: number }).lowDeciC;

    expect(highLowWords(blank, 'imperial')).toBeNull();
  });

  it('reads in metric when the farm does', () => {
    expect(highLowWords(day({ highDeciC: 300, lowDeciC: 100 }), 'metric')).toBe(
      'High 30° · Low 10°',
    );
  });

  /**
   * The exact shape of the complaint: one figure must never come back as two
   * identical ones. A genuinely flat day is possible and is not this — that one
   * has both halves forecast, and says so.
   */
  it('never repeats one figure as though it were two', () => {
    const evening = day({ lowDeciC: 261 });
    delete (evening as { highDeciC?: number }).highDeciC;

    expect(highLowWords(evening, 'imperial')).not.toBe('High 79° · Low 79°');
    expect(highLowWords(day({ highDeciC: 261, lowDeciC: 261 }), 'imperial')).toBe(
      'High 79° · Low 79°',
    );
  });
});
