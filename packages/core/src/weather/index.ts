import { type Forecast, forecastSchema, isStale } from '@steading/contracts';
import { localStore } from '../db/store';
import { fetchForecast, type Grid, OutsideCoverageError } from './provider';

/**
 * The forecast a screen reads, and how it gets there.
 *
 * ## Cache first, always
 *
 * Every screen in this app renders the local store and nothing else, and this
 * is no exception — the difference is only that what is cached came from a
 * service rather than from the farm. A screen never awaits a fetch: it reads
 * what is there, and a refresh replaces it when one arrives.
 *
 * That is what makes the row on Today safe. Opening the app in a barn shows
 * the last forecast heard, labelled with its age, rather than a spinner that
 * never resolves.
 *
 * ## Never on the wire
 *
 * The cache is not a record. It never enters the outbox, never reaches
 * `records`, and is wiped with everything else on sign-out. See
 * `contracts/weather.ts` for why a forecast cannot be an entity.
 */

export {
  findGrid,
  findPlace,
  type Grid,
  OutsideCoverageError,
  type Place,
  type Position,
} from './provider';

/** What the screens get: the forecast, and how much to trust it. */
export interface Weather {
  forecast: Forecast;
  /** True past 48 hours — see FORECAST_STALE_MS. */
  stale: boolean;
  /** When this device last heard, for the line under the row. */
  fetchedAt: number;
}

export async function readWeather(now: number = Date.now()): Promise<Weather | null> {
  const cached = await localStore().readForecast();
  if (cached === null) return null;

  const parsed = forecastSchema.safeParse(JSON.parse(cached.value));
  // A cache written by an older build is not an error worth showing. It is
  // replaced by the next refresh, and until then there is simply no forecast.
  if (!parsed.success) return null;

  return {
    forecast: parsed.data,
    stale: isStale(parsed.data, now),
    fetchedAt: cached.fetchedAt,
  };
}

/**
 * How often a device asks, at most.
 *
 * NWS updates roughly hourly and asks callers not to poll harder than that.
 * A farm opening the app six times in a morning must not make six requests —
 * the answer would be the same one six times, and the fetch is the only thing
 * on this screen that costs anything.
 */
const MIN_GAP_MS = 60 * 60 * 1000;

export interface RefreshResult {
  /** Null when nothing was fetched — too soon, or no position yet. */
  weather: Weather | null;
  /** Set when the farm is outside NWS coverage, which no retry fixes. */
  uncovered?: boolean;
}

/**
 * Fetches if it is worth fetching, and writes what it got.
 *
 * Deliberately outside the flush loop. A forecast must never delay a mutation,
 * and a failed forecast must never look like a failed sync — the sync chip is
 * about a farm's own records reaching the server, and the weather not loading
 * is not that.
 *
 * Errors are swallowed on purpose. The cache is the feature; a fetch that
 * fails leaves the last one in place with its age showing, which is exactly
 * what should happen with no signal.
 */
export async function refreshWeather(
  grid: Grid,
  now: number = Date.now(),
): Promise<RefreshResult> {
  const cached = await localStore().readForecast();
  if (cached !== null && now - cached.fetchedAt < MIN_GAP_MS) {
    return { weather: await readWeather(now) };
  }

  try {
    const forecast = await fetchForecast(grid, now);
    await localStore().writeForecast({
      issuedAt: forecast.issuedAt,
      fetchedAt: now,
      value: JSON.stringify(forecast),
    });
    return { weather: await readWeather(now) };
  } catch (error) {
    if (error instanceof OutsideCoverageError) {
      return { weather: await readWeather(now), uncovered: true };
    }
    // Offline, or the service is having a bad morning. Neither is worth a
    // message: the row shows what it last heard and how old that is.
    return { weather: await readWeather(now) };
  }
}

/** For tests and for a farm that moves its pin. */
export async function forgetWeather(): Promise<void> {
  await localStore().writeForecast({ issuedAt: 0, fetchedAt: 0, value: '{}' });
}

export type { Forecast };
