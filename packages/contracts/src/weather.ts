import { z } from 'zod';

/**
 * The forecast, as this app uses it.
 *
 * ## Not an entity, and that is deliberate
 *
 * Nobody authors a forecast. It cannot conflict, it is not something the farm
 * did, and two devices fetching the same site would mint two ULIDs for one
 * fact. So it never enters the outbox, never reaches `records`, and never
 * crosses the wire — it is a cache, in its own table, wiped with the rest of a
 * farm's cache on sign-out. The same category the bundled zone lookup already
 * has, and the same reasoning that keeps `Due` off the wire.
 *
 * ## Five numbers, and no more
 *
 * A provider will hand over forty fields. What a farm reads at 6am is what it
 * is now, what it will get to, what it will drop to, and whether to expect
 * rain. Everything else is a table nobody scans, and every field kept is a
 * field that has to survive a provider change.
 *
 * Temperatures are **tenths of a degree Celsius as integers**, matching every
 * other measure in this codebase: micrograms for mass, micrometres for length,
 * millilitres for volume. Floats accumulate error across a season and there is
 * no reason to start now.
 */

export const CONDITIONS = [
  'clear',
  'cloud',
  'fog',
  'drizzle',
  'rain',
  'snow',
  'storm',
] as const;
export const conditionSchema = z.enum(CONDITIONS);
export type Condition = z.infer<typeof conditionSchema>;

export const forecastDaySchema = z
  .object({
    /** Local midnight for the day this describes. */
    day: z.number().int(),
    condition: conditionSchema,
    /** Tenths of a degree Celsius. */
    highDeciC: z.number().int(),
    lowDeciC: z.number().int(),
    /** Per cent, 0–100. */
    rainChance: z.number().int().min(0).max(100),
    /** Micrometres of rain expected, so it charts in the same unit as depth. */
    rainUm: z.number().int().nonnegative(),
  })
  .strict();

export type ForecastDay = z.infer<typeof forecastDaySchema>;

export const forecastNowSchema = z
  .object({
    condition: conditionSchema,
    tempDeciC: z.number().int(),
  })
  .strict();

export type ForecastNow = z.infer<typeof forecastNowSchema>;

/**
 * One hour, for today.
 *
 * Chosen over a fourteen- or thirty-day view, and the reasoning is worth
 * keeping: "rain starts at four" changes what somebody does this afternoon,
 * and "week four looks wet" changes nothing anybody can act on. The National
 * Weather Service publishes hourly and does not publish thirty days, so the
 * limit and the better answer happen to agree.
 */
export const forecastHourSchema = z
  .object({
    at: z.number().int(),
    condition: conditionSchema,
    tempDeciC: z.number().int(),
    rainChance: z.number().int().min(0).max(100),
  })
  .strict();

export type ForecastHour = z.infer<typeof forecastHourSchema>;

export const forecastSchema = z
  .object({
    /** When the provider made this run — what staleness is judged on. */
    issuedAt: z.number().int(),
    now: forecastNowSchema,
    days: z.array(forecastDaySchema),
    /** Today, hour by hour. Empty when the provider had none to give. */
    hours: z.array(forecastHourSchema).default([]),
  })
  .strict();

export type Forecast = z.infer<typeof forecastSchema>;

/**
 * How old a forecast may be before it is not shown at all.
 *
 * A three-day-old forecast displayed as current is worse than none: it is
 * wrong with a confident number on the one screen this app asks people to
 * trust. Past this it vanishes rather than lying, and the row says the farm
 * has not heard lately.
 *
 * Judged on `issuedAt`, not on when the device fetched. A phone that has been
 * in a pocket for a day did not make the forecast older; it just stopped
 * hearing about it, and the last run it heard is still the last run there was.
 */
export const FORECAST_STALE_MS = 48 * 60 * 60 * 1000;

export function isStale(forecast: Forecast, now: number): boolean {
  return now - forecast.issuedAt > FORECAST_STALE_MS;
}

/** Tenths of a degree Celsius to whole degrees Fahrenheit. */
export function deciCToF(deciC: number): number {
  return Math.round((deciC / 10) * (9 / 5) + 32);
}

/** Tenths of a degree Celsius to whole degrees Celsius. */
export function deciCToC(deciC: number): number {
  return Math.round(deciC / 10);
}

/**
 * Coordinates, rounded to about a kilometre.
 *
 * A farm's position identifies a family's home. Two decimals is ample for a
 * forecast and useless for finding a door, so whatever a device or a search
 * hands over is rounded **before** it is stored — there is nowhere in this app
 * that keeps the precise value, which is the only way that promise holds.
 */
export function roundPosition(lat: number, lon: number): { lat: number; lon: number } {
  return { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
}
