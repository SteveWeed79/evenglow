import { z } from 'zod';
import { deciCToFahrenheit, type UnitSystem } from './units';

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
    /**
     * Relative humidity, per cent. **Optional, and the optionality is load-
     * bearing.**
     *
     * Heat stress in a ruminant is a function of temperature AND humidity —
     * 32°C at 30% is a warm day and 32°C at 80% is dangerous — so the THI
     * warning cannot be computed without it. But it arrived after the cache
     * table did, and a required field would make every forecast written by an
     * older build fail to parse: a farm updating the app would lose the
     * forecast it had until the next fetch, for a field only one warning uses.
     *
     * Absent means the THI warning stays silent. Silence is the right failure
     * for a warning: inventing a humidity would produce a confident number
     * nobody measured.
     */
    humidity: z.number().int().min(0).max(100).optional(),
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

/**
 * A temperature as a whole number, in the farm's own system.
 *
 * `formatTemperature` already exists and says "52°F", which is right in a
 * sentence and wrong in a forecast: a row reading "46° · high 52 low 31" says
 * the unit once at most, and a strip of seven days cannot afford it at all.
 * The conversion is `deciCToFahrenheit`'s — not a second one — because two
 * implementations of the same arithmetic is how they drift apart.
 */
export function degrees(deciC: number, system: UnitSystem): number {
  const rounded = Math.round(system === 'metric' ? deciC / 10 : deciCToFahrenheit(deciC));
  // `+ 0` normalises -0 to 0. Without it a −0.2 °C morning renders as "-0°",
  // which reads as a bug to anyone who sees it. `trim` in units.ts does the
  // same thing for the same reason.
  return rounded + 0;
}

/** Local midnight for a moment, which is how a forecast day is keyed. */
export function dayStart(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Today's entry in a forecast, or the nearest one still ahead.
 *
 * A forecast fetched last night and read this morning has yesterday at the
 * front of the list, and showing yesterday's high beside this minute's
 * temperature is the kind of quietly wrong that nobody reports and everybody
 * stops trusting. Falls forward rather than back for the same reason: a
 * tomorrow labelled honestly beats a yesterday labelled "today".
 */
export function forecastFor(
  days: readonly ForecastDay[],
  now: number,
): ForecastDay | undefined {
  const today = dayStart(now);
  return days.find((day) => day.day === today) ?? days.find((day) => day.day > today);
}

/** What the sky is called, for a screen reader and for the row's own words. */
export const CONDITION_WORDS: Record<Condition, string> = {
  clear: 'Clear',
  cloud: 'Cloudy',
  fog: 'Fog',
  drizzle: 'Drizzle',
  rain: 'Rain',
  snow: 'Snow',
  storm: 'Storms',
};

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
