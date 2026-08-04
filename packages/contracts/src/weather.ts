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

/**
 * What it is doing right now, **measured**.
 *
 * ## Why this is not just the first hour of the forecast
 *
 * It was, and that was wrong in a way that only shows up somewhere with
 * weather. The hourly product gives a forecast FOR the current hour, so the
 * number on Today was a prediction wearing the label "now" — and a Kansas
 * summer afternoon can climb ten degrees in half an hour. The app would have
 * shown 74° with confidence while it was 84° in the yard, on the one screen
 * this app asks people to trust.
 *
 * An observation is a reading from a real thermometer at the nearest airfield.
 * ASOS stations report every twenty minutes as a matter of course, and file a
 * SPECI report out of cycle when conditions change sharply — which is to say
 * the mechanism exists precisely because of the case this fixes.
 *
 * ## It carries its own age, and that is not decoration
 *
 * The nearest station can be forty miles away and its last report twenty-five
 * minutes old. On a still morning that is nothing; on the afternoon this
 * exists for it is the difference between a number and a guess. So the age
 * travels with the reading and the screen says it.
 */
export const observationSchema = z
  .object({
    /** When the station took the reading — not when this device asked. */
    at: z.number().int(),
    /** Tenths of a degree Celsius. */
    tempDeciC: z.number().int(),
    condition: conditionSchema,
    /** Per cent. Absent on a station that does not report it. */
    humidity: z.number().int().min(0).max(100).optional(),
    /**
     * The station's own heat index, where it publishes one.
     *
     * Kept rather than recomputed: it is what the National Weather Service
     * says about this reading, and a second implementation of the same
     * arithmetic is a second thing to drift.
     */
    feelsLikeDeciC: z.number().int().optional(),
    /** "Manhattan Regional Airport" — so a farm can judge how far off it is. */
    station: z.string().max(120).optional(),
  })
  .strict();

export type Observation = z.infer<typeof observationSchema>;

/**
 * How old a reading may be before it stops being "now".
 *
 * Ninety minutes, which is generous against a twenty-minute reporting cycle —
 * the point is not to be strict, it is to refuse to call something current
 * when the station has plainly stopped reporting. Past this the row falls back
 * to the forecast's figure for the hour, which is worse but honest, and says
 * which it is showing.
 */
export const OBSERVATION_STALE_MS = 90 * 60 * 1000;

export function observationIsStale(observation: Observation, now: number): boolean {
  return now - observation.at > OBSERVATION_STALE_MS;
}

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

// ── official alerts ──────────────────────────────────────────────────────────

/**
 * A watch, warning or advisory issued by the National Weather Service.
 *
 * ## Not the same thing as a `Warning`
 *
 * `warnings.ts` derives its rows from the farm's own records against the
 * forecast: your alpacas plus this humidity is a heat problem. Those are this
 * app's opinion, computed on the device, and they are worth having because
 * nobody else knows what stock is in which field.
 *
 * An alert is not an opinion. It is a meteorologist saying a tornado is on the
 * ground, and it is the one thing on this screen with an authority behind it.
 * So they are a separate type, cached separately, and rendered above the
 * derived rows — because a farm reading top to bottom must not meet "your hens
 * are warm" before it meets a tornado warning.
 *
 * Folding them into `WARNING_KINDS` would also mean inventing a kind for each
 * of roughly eighty NWS event types, and every one would be a guess at an icon
 * and a threshold for something already carrying its own severity.
 *
 * ## Parsed, never trusted
 *
 * Invariant 11. The service's shape becomes ours at the boundary, so a field
 * that moves cannot reach a screen.
 */
export const ALERT_SEVERITIES = ['extreme', 'severe', 'moderate', 'minor', 'unknown'] as const;
export const alertSeveritySchema = z.enum(ALERT_SEVERITIES);
export type AlertSeverity = z.infer<typeof alertSeveritySchema>;

export const alertSchema = z
  .object({
    /** The service's own id, so a re-fetch replaces rather than duplicates. */
    id: z.string().max(300),
    /** "Tornado Warning", "Freeze Watch" — the official event name. */
    event: z.string().max(120),
    severity: alertSeveritySchema,
    /** The one-line summary the service writes for exactly this purpose. */
    headline: z.string().max(500).optional(),
    /**
     * The full text. Long — often several hundred words — and kept whole
     * because trimming a safety instruction is not this app's call to make.
     */
    description: z.string().max(20_000).optional(),
    /** What to actually do, where the service says. */
    instruction: z.string().max(20_000).optional(),
    /** When it starts biting. Absent means it already is. */
    onset: z.number().int().optional(),
    /**
     * When it stops.
     *
     * **Load-bearing.** An expired alert must never show: a tornado warning
     * still on screen an hour after it lapsed teaches a farm that this row
     * does not mean anything, which is the one row where that lesson is fatal.
     */
    endsAt: z.number().int().optional(),
    /** "Riley County, KS" — so a farm can tell whether it is actually them. */
    area: z.string().max(500).optional(),
  })
  .strict();

export type Alert = z.infer<typeof alertSchema>;

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  extreme: 0,
  severe: 1,
  moderate: 2,
  minor: 3,
  unknown: 4,
};

/**
 * Whether an alert is still in force.
 *
 * An alert with no end time is treated as live. The service omits `ends` on
 * some products, and dropping those would silently hide a whole class of
 * warning — the failure has to fall on the side of showing one too many.
 */
export function alertLive(alert: Alert, now: number): boolean {
  return alert.endsAt === undefined || alert.endsAt > now;
}

/** The live ones, worst first. Ties keep their id order so a list holds still. */
export function liveAlerts(alerts: readonly Alert[], now: number): Alert[] {
  return alerts
    .filter((alert) => alertLive(alert, now))
    .sort((a, b) => {
      const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (bySeverity !== 0) return bySeverity;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/**
 * How long a cached alert set may be trusted.
 *
 * Far shorter than the forecast's two days, because the whole value of an
 * alert is that it is current. Past this the screen stops showing them rather
 * than showing old ones: silence is survivable, a lapsed tornado warning
 * presented as live is not.
 */
export const ALERTS_STALE_MS = 60 * 60 * 1000;
