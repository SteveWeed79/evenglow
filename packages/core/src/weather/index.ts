import { type Forecast, forecastSchema, isStale } from '@steading/contracts';
import { localStore } from '../db/store';
import {
  fetchForecast,
  findGrid,
  type Grid,
  OutsideCoverageError,
  type Position,
} from './provider';

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
export const MIN_GAP_MS = 60 * 60 * 1000;

/**
 * Whether a refresh would actually ask anybody anything.
 *
 * Exported because a caller has to be able to know **before** it says it is
 * asking. Without this, a screen sets "Asking…" on every attempt and clears it
 * a millisecond later when the gap turns the attempt into a no-op — which is
 * invisible when it happens once and is a strobing button when the thing
 * driving it fires on every mutation.
 */
export function wouldFetch(cached: { fetchedAt: number } | null, now: number): boolean {
  return cached === null || now - cached.fetchedAt >= MIN_GAP_MS;
}

export interface RefreshResult {
  /** What to render. Null only when nothing has ever been cached. */
  weather: Weather | null;
  /** Set when the farm is outside NWS coverage, which no retry fixes. */
  uncovered?: boolean;
  /** "Burlington, VT", when the grid lookup named the place. */
  placeName?: string;
}

/**
 * The grid for the position asked about last, kept for the process.
 *
 * NWS resolves coordinates to a grid square before it will forecast, and that
 * mapping never changes for a fixed position — a farm does not move. Caching it
 * in SQLite would mean a table and a migration for a value one round trip
 * rebuilds; caching it here costs one extra request per app launch, and only on
 * the launch that actually fetches.
 *
 * Keyed by the rounded position so moving the pin discards it rather than
 * forecasting the old valley.
 */
let known: { key: string; grid: Grid } | null = null;

async function gridFor(at: Position): Promise<Grid> {
  const key = `${at.lat},${at.lon}`;
  if (known !== null && known.key === key) return known.grid;

  const grid = await findGrid(at);
  known = { key, grid };
  return grid;
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
export interface RefreshOptions {
  now?: number;
  /**
   * Asks even inside the hour.
   *
   * For the one case the gap is wrong about: somebody has pressed "try again"
   * because the last attempt failed, or has just moved the pin. Both are a
   * person waiting at the screen, which is the opposite of the six-launches-a-
   * morning case the gap exists for.
   *
   * Deliberately a flag rather than "pass a `now` an hour ahead". That trick
   * would write a `fetchedAt` in the future and poison the gap for every later
   * refresh — the cache would look fresh for an hour that never elapses.
   */
  force?: boolean;
}

export async function refreshWeather(
  at: Position,
  options: RefreshOptions = {},
): Promise<RefreshResult> {
  const now = options.now ?? Date.now();
  const cached = await localStore().readForecast();
  /**
   * The gap is checked before the grid lookup, not after.
   *
   * A farm opening the app six times in a morning would otherwise make six
   * `/points` requests to decide six times that it already had the answer —
   * the request the cache exists to avoid, moved one step earlier.
   */
  if (options.force !== true && cached !== null && now - cached.fetchedAt < MIN_GAP_MS) {
    return {
      weather: await readWeather(now),
      ...(known?.grid.placeName === undefined ? {} : { placeName: known.grid.placeName }),
    };
  }

  try {
    const grid = await gridFor(at);
    const forecast = await fetchForecast(grid, now);
    await localStore().writeForecast({
      issuedAt: forecast.issuedAt,
      fetchedAt: now,
      value: JSON.stringify(forecast),
    });
    return {
      weather: await readWeather(now),
      ...(grid.placeName === undefined ? {} : { placeName: grid.placeName }),
    };
  } catch (error) {
    if (error instanceof OutsideCoverageError) {
      return { weather: await readWeather(now), uncovered: true };
    }
    // Offline, or the service is having a bad morning. Neither is worth a
    // message: the row shows what it last heard and how old that is.
    return { weather: await readWeather(now) };
  }
}

/**
 * Drops the cached forecast and the grid with it.
 *
 * Both, and the grid is the one that matters: a farm that has corrected its
 * position must not be handed the previous valley's square on the next
 * refresh, and that square is held in memory where no store wipe reaches it.
 */
export async function forgetWeather(): Promise<void> {
  known = null;
  await localStore().writeForecast({ issuedAt: 0, fetchedAt: 0, value: '{}' });
}

export type { Forecast };
