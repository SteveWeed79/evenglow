import {
  type Alert,
  alertSchema,
  type AlertSeverity,
  type Condition,
  type Forecast,
  type ForecastHour,
  forecastSchema,
  type Observation,
  observationSchema as observationShape,
  roundPosition,
} from '@steading/contracts';
import { z } from 'zod';
import { PRODUCT_NAME } from '@steading/contracts';

/**
 * Where a forecast comes from: the US National Weather Service.
 *
 * ## Why NOAA rather than the obvious alternative
 *
 * Open-Meteo was the first choice and it carried a problem this does not.
 * Its keyless tier is licensed **non-commercial only** — its own terms name
 * apps with subscriptions or advertising — and the masterplan has a Play Store
 * track. That is a licence cliff at distribution, not a rate limit, and its
 * paid tier authenticates with an `apikey` query parameter, which invariant 12
 * forbids in a bundle shipping inside an APK. The fix would have been a server
 * proxy built before there was a bill.
 *
 * **`api.weather.gov` is a work of the US government and in the public
 * domain.** No key, no licence tier, no cliff, and nothing to put in a bundle.
 * The server proxy stops being urgent — it becomes an optimisation for
 * caching across a farm's devices rather than a condition of shipping.
 *
 * ## What it costs, stated plainly
 *
 * **It is the United States only.** `/points` answers 404 outside US
 * territory, and there is no fallback in this file. A farm elsewhere gets no
 * forecast — which the screen has to say honestly rather than showing an
 * empty box.
 *
 * **Seven days, not thirty.** NWS publishes about fourteen day/night periods.
 * There is no fourteen- or thirty-day forecast to be had from it at any price.
 *
 * **Rain chance, not rain amount.** The forecast periods carry
 * `probabilityOfPrecipitation` and no quantity; the amounts live in the raw
 * gridpoint product, which is a different and much larger response. So the
 * chart plots chance, which is the number a farm acts on anyway — "will I get
 * wet" rather than "how many millimetres".
 *
 * ## Two requests, and why the first is cached
 *
 * NWS resolves coordinates to a grid square before it will forecast. That
 * mapping never changes for a fixed position, so it is fetched once and kept
 * with the site — a farm does not move, and spending a round trip rediscovering
 * that every hour would be the app being slow on purpose.
 *
 * ## Parsed, never trusted
 *
 * An API response is external data (invariant 11). The service's shape is
 * parsed into ours here, so a field that moves cannot reach a screen and the
 * app's own `Forecast` does not change when the provider does.
 */

const BASE = 'https://api.weather.gov';

/**
 * NWS asks callers to identify themselves and will refuse a request without
 * it. Not a secret — it is a courtesy header naming the app, and it appears in
 * their logs rather than in an Authorization slot. Nothing here is withheld
 * from the bundle because nothing here is worth withholding.
 */
const HEADERS = {
  'User-Agent': `(${PRODUCT_NAME} farm app, https://github.com/SteveWeed79/steading)`,
  Accept: 'application/geo+json',
};

async function ask<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(url, { headers: HEADERS });

  if (res.status === 404) {
    // The one failure worth naming, because it is not transient and no amount
    // of retrying fixes it.
    throw new OutsideCoverageError();
  }
  if (!res.ok) throw new Error(`The weather service answered ${res.status}.`);

  return schema.parse(await res.json());
}

/** Raised when the farm is outside what the National Weather Service covers. */
export class OutsideCoverageError extends Error {
  constructor() {
    super('The National Weather Service only covers the United States.');
    this.name = 'OutsideCoverageError';
  }
}

const pointSchema = z.object({
  properties: z.object({
    forecast: z.string(),
    forecastHourly: z.string().optional(),
    /** The list of nearby reporting stations, nearest first. */
    observationStations: z.string().optional(),
    relativeLocation: z
      .object({
        properties: z.object({ city: z.string(), state: z.string() }).partial(),
      })
      .optional(),
  }),
});

const forecastResponseSchema = z.object({
  properties: z.object({
    updated: z.string().optional(),
    periods: z.array(
      z.object({
        startTime: z.string(),
        isDaytime: z.boolean(),
        temperature: z.number(),
        temperatureUnit: z.string().optional(),
        probabilityOfPrecipitation: z
          .object({ value: z.number().nullable() })
          .optional(),
        // Added to the forecast periods by NWS after the rest of this shape
        // was written, and optional here because a grid that omits it must
        // still forecast. See `humidity` in the contract for what it costs.
        relativeHumidity: z.object({ value: z.number().nullable() }).optional(),
        shortForecast: z.string(),
      }),
    ),
  }),
});

/**
 * NWS describes the sky in prose — "Chance Showers And Thunderstorms" — rather
 * than with a numeric code, so this matches words.
 *
 * Ordered most specific first, because "Chance Showers And Thunderstorms"
 * contains both "showers" and "thunderstorms" and the storm is the one that
 * changes what somebody does.
 */
function conditionOf(text: string): Condition {
  const said = text.toLowerCase();
  if (said.includes('thunder')) return 'storm';
  if (said.includes('snow') || said.includes('sleet') || said.includes('flurries')) return 'snow';
  if (said.includes('freezing') || said.includes('ice')) return 'snow';
  if (said.includes('drizzle')) return 'drizzle';
  if (said.includes('rain') || said.includes('shower')) return 'rain';
  if (said.includes('fog') || said.includes('haze')) return 'fog';
  if (said.includes('cloud') || said.includes('overcast')) return 'cloud';
  return 'clear';
}

/** Fahrenheit to tenths of a degree Celsius, the canonical unit here. */
function toDeciC(value: number, unit: string | undefined): number {
  return unit === 'C' ? Math.round(value * 10) : Math.round(((value - 32) * 5) / 9 * 10);
}

/** Local midnight for an ISO timestamp the service returned. */
function dayOf(iso: string): number {
  const at = new Date(iso);
  at.setHours(0, 0, 0, 0);
  return at.getTime();
}

export interface Position {
  lat: number;
  lon: number;
}

export interface Place {
  /** "1 Farm Road, Hollow, VT" — what the search matched, said back. */
  name: string;
  lat: number;
  lon: number;
}

const censusSchema = z.object({
  result: z.object({
    addressMatches: z
      .array(
        z.object({
          matchedAddress: z.string(),
          coordinates: z.object({ x: z.number(), y: z.number() }),
        }),
      )
      .optional(),
  }),
});

/**
 * A typed address to coordinates, via the US Census Bureau.
 *
 * The fallback when somebody declines the location permission, and it is
 * chosen to match the forecast rather than to be the best geocoder in the
 * world: the Census service is **public domain, keyless, and United States
 * only** — exactly the coverage NWS has. A geocoder that answered for Devon
 * would hand back coordinates the forecast then refuses, which is a worse
 * failure than not answering.
 *
 * It wants something address-shaped. "Hollow, VT" often resolves; a street
 * address always does, which is what the field asks for.
 */
export async function findPlace(query: string): Promise<Place[]> {
  const params = new URLSearchParams({
    address: query,
    benchmark: 'Public_AR_Current',
    format: 'json',
  });

  const res = await fetch(
    `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params.toString()}`,
  );
  if (!res.ok) throw new Error(`The address search answered ${res.status}.`);

  const body = censusSchema.parse(await res.json());

  return (body.result.addressMatches ?? []).map((match) => {
    // x is longitude and y is latitude, which is the opposite order to how
    // everything else here says it. Rounded on the way out like every other
    // position — see roundPosition.
    const { lat, lon } = roundPosition(match.coordinates.y, match.coordinates.x);
    return { name: match.matchedAddress, lat, lon };
  });
}

/** What `/points` resolves to. Fixed for a fixed position, so it is kept. */
export interface Grid {
  forecastUrl: string;
  /** Today, hour by hour. Absent on the rare grid that publishes none. */
  hourlyUrl?: string;
  /** Where the nearest reporting stations are listed. */
  stationsUrl?: string;
  /** "Burlington, VT" — what the farm can be shown it picked. */
  placeName?: string;
}

export async function findGrid(at: Position): Promise<Grid> {
  const { lat, lon } = roundPosition(at.lat, at.lon);
  const body = await ask(`${BASE}/points/${lat},${lon}`, pointSchema);

  const where = body.properties.relativeLocation?.properties;
  const named = [where?.city, where?.state].filter(Boolean).join(', ');

  return {
    forecastUrl: body.properties.forecast,
    ...(body.properties.forecastHourly === undefined
      ? {}
      : { hourlyUrl: body.properties.forecastHourly }),
    ...(body.properties.observationStations === undefined
      ? {}
      : { stationsUrl: body.properties.observationStations }),
    ...(named === '' ? {} : { placeName: named }),
  };
}

const stationsSchema = z.object({
  features: z.array(
    z.object({
      properties: z.object({
        stationIdentifier: z.string(),
        name: z.string().optional(),
      }),
    }),
  ),
});

const observationSchema_ = z.object({
  properties: z.object({
    timestamp: z.string(),
    // Every value is nullable: a station reports what its sensors give, and a
    // missing temperature is ordinary rather than exceptional.
    temperature: z.object({ value: z.number().nullable() }),
    relativeHumidity: z.object({ value: z.number().nullable() }).optional(),
    heatIndex: z.object({ value: z.number().nullable() }).optional(),
    textDescription: z.string().optional(),
  }),
});

/** Celsius, as NWS reports observations, to the canonical tenths. */
function celsiusToDeci(value: number): number {
  return Math.round(value * 10);
}

/**
 * The nearest station that is actually reporting, and its latest reading.
 *
 * ## Why it walks the list rather than taking the first
 *
 * `observationStations` is ordered nearest-first, and the nearest is often a
 * small airfield whose AWOS is down for the week. Taking it and giving up
 * would mean a farm sees no current temperature at all because of an outage
 * forty miles away that nobody is going to fix. Three is enough to get past an
 * ordinary outage without turning one screen into a dozen requests.
 *
 * ## What it costs, stated
 *
 * The station can be a long way off. That is why the reading carries the
 * station's name and its own timestamp — the screen can say "Manhattan
 * Regional, 12 minutes ago" and let a farmer judge it, which is the honest
 * thing to do with a number measured somewhere else.
 */
export async function fetchObservation(grid: Grid): Promise<Observation | null> {
  if (grid.stationsUrl === undefined) return null;

  const stations = await ask(grid.stationsUrl, stationsSchema);

  for (const feature of stations.features.slice(0, 3)) {
    const id = feature.properties.stationIdentifier;

    try {
      const body = await ask(
        `${BASE}/stations/${id}/observations/latest`,
        observationSchema_,
      );
      const said = body.properties;
      const temperature = said.temperature.value;
      const at = Date.parse(said.timestamp);

      // A station reporting no temperature is reporting nothing this app can
      // use, so move on rather than showing a hole.
      if (temperature === null || Number.isNaN(at)) continue;

      const humidity = said.relativeHumidity?.value;
      const feels = said.heatIndex?.value;

      return observationShape.parse({
        at,
        tempDeciC: celsiusToDeci(temperature),
        condition: conditionOf(said.textDescription ?? ''),
        ...(humidity === null || humidity === undefined
          ? {}
          : { humidity: Math.round(humidity) }),
        ...(feels === null || feels === undefined
          ? {}
          : { feelsLikeDeciC: celsiusToDeci(feels) }),
        ...(feature.properties.name === undefined ? {} : { station: feature.properties.name }),
      });
    } catch {
      // This station is down or answering oddly. Try the next one.
      continue;
    }
  }

  return null;
}

/**
 * Today, hour by hour.
 *
 * Fetched alongside the daily forecast rather than on demand, because the
 * screen that shows it is one tap from Today and a farm on a barn wifi should
 * not wait for a second round trip to see whether the rain arrives before
 * milking. Failing is not fatal — the daily list is the feature, and an app
 * that showed nothing because the optional half timed out would be worse than
 * one that showed seven days.
 */
async function fetchHours(grid: Grid, now: number): Promise<ForecastHour[]> {
  if (grid.hourlyUrl === undefined) return [];

  const body = await ask(grid.hourlyUrl, forecastResponseSchema);

  /**
   * "Today" means the DEVICE's today, and that is the right choice with a
   * caveat worth writing down.
   *
   * NWS stamps its periods in the grid's own offset; the phone knows its own.
   * For a farm standing on its own land those are the same, which is every
   * real use of this app. They differ for a phone travelling — and a phone in
   * Denver asking about a Vermont farm should show the Vermont day, which this
   * does not do. It is the lesser error: bending to the grid's offset would
   * make "the rest of today" mean a day the person holding the phone is not
   * having.
   *
   * From `now` rather than from the wall clock, so a test gets the window it
   * asked about.
   */
  const thisHour = new Date(now);
  thisHour.setMinutes(0, 0, 0);
  const startOfHour = thisHour.getTime();

  return body.properties.periods
    .map((period) => ({
      at: Date.parse(period.startTime),
      condition: conditionOf(period.shortForecast),
      tempDeciC: toDeciC(period.temperature, period.temperatureUnit),
      rainChance: Math.round(period.probabilityOfPrecipitation?.value ?? 0),
    }))
    /**
     * A rolling window forward, rather than whatever is left of today.
     *
     * It used to stop at midnight, which meant the section emptied out as the
     * evening went on and at eight o'clock offered four hours and then nothing.
     * Reported from the phone: *"under The rest of today it literally stops at
     * 11pm."* Correct to its own label, and useless at the hour somebody is
     * deciding whether to cover a bed or shut a coop.
     *
     * The original argument still holds and is why this is not a fortnight —
     * *"rain starts at four" changes what somebody does this afternoon, and
     * "week four looks wet" changes nothing anybody can act on.* Twenty-four
     * hours keeps that and adds the half a farm actually asks about after dark:
     * tonight's low and what the morning looks like.
     *
     * Hours already gone are still dropped. NWS starts its hourly product at
     * the current hour so this is usually moot, but a cached forecast read four
     * hours later is not, and "rain at 9am" on a screen opened at one o'clock
     * is a lie about the afternoon.
     */
    .filter((hour) => !Number.isNaN(hour.at) && hour.at >= startOfHour)
    .slice(0, 24);
}

/**
 * The forecast, folded from day/night periods into days.
 *
 * NWS alternates: "Today" then "Tonight" then "Monday" then "Monday Night".
 * A farm reads a day, so the daytime period supplies the high and the
 * condition, and the night that follows supplies the low. The first period can
 * be a night — the app is opened in the evening as often as the morning — so
 * this pairs by date rather than by position.
 */
export async function fetchForecast(grid: Grid, now: number = Date.now()): Promise<Forecast> {
  const [body, hours] = await Promise.all([
    ask(grid.forecastUrl, forecastResponseSchema),
    // Optional. A missing hourly list costs a tab, not the feature.
    fetchHours(grid, now).catch(() => [] as ForecastHour[]),
  ]);
  const periods = body.properties.periods;

  const byDay = new Map<
    number,
    { high?: number; low?: number; condition?: Condition; chance: number; humidity?: number }
  >();

  for (const period of periods) {
    const day = dayOf(period.startTime);
    const entry = byDay.get(day) ?? { chance: 0 };
    const deciC = toDeciC(period.temperature, period.temperatureUnit);

    if (period.isDaytime) {
      entry.high = deciC;
      // The daytime sky is what a day is called. "Cloudy" from a night period
      // describes hours nobody was working in.
      entry.condition = conditionOf(period.shortForecast);
      /**
       * The DAYTIME humidity, and only that.
       *
       * Heat stress is a daytime problem, and overnight humidity is
       * mechanically higher — air cools towards its dewpoint — so folding both
       * halves together, or letting the night win, would raise a THI warning
       * about hours when nothing was hot. Taken with the high it pairs with.
       */
      const said = period.relativeHumidity?.value;
      if (said !== null && said !== undefined) entry.humidity = Math.round(said);
    } else {
      entry.low = deciC;
      // A night with no daytime beside it still needs a name — the evening
      // case, where the first period returned is tonight.
      entry.condition ??= conditionOf(period.shortForecast);
    }

    // The higher of the two halves: a forty per cent chance overnight is still
    // a reason to bring something in.
    entry.chance = Math.max(entry.chance, period.probabilityOfPrecipitation?.value ?? 0);
    byDay.set(day, entry);
  }

  const days = [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    // Seven, because that is what the screen promises and what the contract
    // documents. NWS publishes about fourteen half-day periods, which folds to
    // seven or eight depending on the hour the app asked.
    .slice(0, 7)
    .map(([day, entry]) => ({
      day,
      condition: entry.condition ?? 'cloud',
      /**
       * Only the halves that were actually forecast.
       *
       * This used to fill each from the other, so a day whose daytime period
       * had already passed reported its overnight low as the high too. The
       * screen then read "79° 79°", which is a real-looking flat day rather
       * than a missing number — and `warnings.ts` read that fabricated high
       * when deciding whether to raise a heat watch.
       *
       * Absent is the honest answer and every reader now handles it. Nothing
       * is invented and nothing falls back to zero, which would have been a
       * hard freeze in the middle of August.
       */
      ...(entry.high === undefined ? {} : { highDeciC: entry.high }),
      ...(entry.low === undefined ? {} : { lowDeciC: entry.low }),
      rainChance: Math.round(entry.chance),
      ...(entry.humidity === undefined ? {} : { humidity: entry.humidity }),
      /**
       * Always zero, and it is honest rather than missing.
       *
       * The forecast periods carry a probability and no quantity; amounts live
       * in the raw gridpoint product, which is a much larger response for a
       * number this app does not currently show. The field stays because the
       * shape is the app's rather than the provider's, and a future provider
       * may fill it.
       */
      rainUm: 0,
    }));

  /**
   * What it is doing right now, from the hourly product where there is one.
   *
   * The daily periods answer a different question. "Today" carries the day's
   * HIGH — so a phone opened at seven in the morning would say 52° when it is
   * actually 34° outside, which is the one number on this row somebody can
   * check by opening a door. The current hour is the honest answer, and the
   * first daily period is the fallback for the grid that publishes no hourly.
   */
  const first = periods[0];
  const thisHour = hours[0];

  return forecastSchema.parse({
    issuedAt:
      body.properties.updated !== undefined && !Number.isNaN(Date.parse(body.properties.updated))
        ? Date.parse(body.properties.updated)
        : now,
    now:
      thisHour === undefined
        ? {
            condition: first === undefined ? 'cloud' : conditionOf(first.shortForecast),
            tempDeciC: first === undefined ? 0 : toDeciC(first.temperature, first.temperatureUnit),
          }
        : { condition: thisHour.condition, tempDeciC: thisHour.tempDeciC },
    days,
    hours,
  });
}

// ── official alerts ──────────────────────────────────────────────────────────

/**
 * NWS severity words, lowercased into ours.
 *
 * Anything unrecognised becomes `unknown` rather than being dropped. A new
 * severity word must not make an alert disappear — an alert this app cannot
 * grade is still an alert a meteorologist issued.
 */
const SEVERITIES: Record<string, AlertSeverity> = {
  extreme: 'extreme',
  severe: 'severe',
  moderate: 'moderate',
  minor: 'minor',
};

const alertsSchema = z.object({
  features: z.array(
    z.object({
      id: z.string().optional(),
      properties: z.object({
        id: z.string().optional(),
        event: z.string().optional(),
        severity: z.string().nullish(),
        headline: z.string().nullish(),
        description: z.string().nullish(),
        instruction: z.string().nullish(),
        onset: z.string().nullish(),
        ends: z.string().nullish(),
        expires: z.string().nullish(),
        areaDesc: z.string().nullish(),
      }),
    }),
  ),
});

/** A timestamp, or undefined — never NaN, which would sort as anything. */
function moment(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : at;
}

/** Long text, kept whole up to the contract's ceiling rather than refused. */
function text(value: string | null | undefined, max: number): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return value.slice(0, max);
}

/**
 * Watches, warnings and advisories in force at a point.
 *
 * ## One request, and no grid
 *
 * Unlike the forecast, `/alerts/active` takes coordinates directly — there is
 * no point lookup to cache and no station list to walk. It is the cheapest
 * call in this file, which is what makes a fifteen-minute refresh reasonable.
 *
 * ## Dropping what will not parse, not the batch
 *
 * An alert missing an event name or an id is unusable, and one unusable
 * feature must not take the tornado warning beside it down with it. Same rule
 * the projections use, and it matters more here.
 */
export async function fetchAlerts(at: { lat: number; lon: number }): Promise<Alert[]> {
  const { lat, lon } = roundPosition(at.lat, at.lon);
  const body = await ask(`${BASE}/alerts/active?point=${lat},${lon}`, alertsSchema);

  return body.features.flatMap((feature) => {
    const said = feature.properties;
    const id = said.id ?? feature.id;
    if (id === undefined || said.event === undefined) return [];

    const parsed = alertSchema.safeParse({
      id: id.slice(0, 300),
      event: said.event.slice(0, 120),
      severity: SEVERITIES[(said.severity ?? '').toLowerCase()] ?? 'unknown',
      ...(text(said.headline, 500) === undefined ? {} : { headline: text(said.headline, 500) }),
      ...(text(said.description, 20_000) === undefined
        ? {}
        : { description: text(said.description, 20_000) }),
      ...(text(said.instruction, 20_000) === undefined
        ? {}
        : { instruction: text(said.instruction, 20_000) }),
      ...(moment(said.onset) === undefined ? {} : { onset: moment(said.onset) }),
      // `ends` is the real expiry; `expires` is when the product itself goes
      // out of date. Either is better than treating a lapsed alert as live.
      ...(moment(said.ends ?? said.expires) === undefined
        ? {}
        : { endsAt: moment(said.ends ?? said.expires) }),
      ...(text(said.areaDesc, 500) === undefined ? {} : { area: text(said.areaDesc, 500) }),
    });

    return parsed.success ? [parsed.data] : [];
  });
}
