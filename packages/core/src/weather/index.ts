import {
  type Alert,
  alertSchema,
  ALERTS_STALE_MS,
  type Forecast,
  forecastSchema,
  isStale,
  liveAlerts,
  type Observation,
  observationIsStale,
  observationSchema,
} from '@steading/contracts';
import { z } from 'zod';
import { localStore } from '../db/store';
import {
  fetchAlerts,
  fetchForecast,
  fetchObservation,
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
  fetchAlerts,
  fetchObservation,
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

/**
 * How often a device asks for a **measured** reading, at most.
 *
 * Ten minutes, against the forecast's hour, and the difference is the point.
 * They are two products with two update rates: NWS regenerates the gridded
 * forecast about hourly, so asking faster returns the same answer; an ASOS
 * station reports every twenty minutes and files out of cycle when conditions
 * change sharply.
 *
 * That second case is why this exists. A Kansas summer afternoon can climb ten
 * degrees in half an hour, and an hourly refresh of a value labelled "now"
 * would have shown a number that was wrong by the time anybody read it.
 */
export const OBSERVATION_GAP_MS = 10 * 60 * 1000;

/** What a screen shows as "now": the reading, and how old it is. */
export interface Measured {
  observation: Observation;
  /** True past ninety minutes — see OBSERVATION_STALE_MS. */
  stale: boolean;
}

export async function readObservation(now: number = Date.now()): Promise<Measured | null> {
  const cached = await localStore().readObservation();
  if (cached === null) return null;

  const parsed = observationSchema.safeParse(JSON.parse(cached.value));
  if (!parsed.success) return null;

  return { observation: parsed.data, stale: observationIsStale(parsed.data, now) };
}

/**
 * Fetches a reading if the ten minutes are up, and writes what it got.
 *
 * Same rules as the forecast refresh: never throws, never blocks a screen, and
 * a failure leaves the last reading in place with its age showing. A station
 * that reports nothing usable is not an error either — the screen falls back
 * to the forecast's figure for the hour and says which it is showing.
 */
export async function refreshObservation(
  at: Position,
  options: RefreshOptions = {},
): Promise<Measured | null> {
  const now = options.now ?? Date.now();
  const cached = await localStore().readObservation();

  const asked = triedAt(cached, lastTried.observation);
  if (options.force !== true && asked !== null && now - asked < OBSERVATION_GAP_MS) {
    return readObservation(now);
  }

  lastTried.observation = now;

  try {
    const grid = await gridFor(at);
    const observation = await fetchObservation(grid);
    // No station near this farm reports, or none of the nearest three is up.
    // The attempt is recorded above, so this does not retry on every publish.
    if (observation === null) return readObservation(now);

    await localStore().writeObservation({
      observedAt: observation.at,
      fetchedAt: now,
      value: JSON.stringify(observation),
    });
    return readObservation(now);
  } catch {
    // Offline, or every nearby station is down. Both leave the last reading
    // where it was, which the screen renders with its age.
    return readObservation(now);
  }
}

/** Whether a refresh would actually ask. The observation's own gap. */
export function wouldFetchObservation(
  cached: { fetchedAt: number } | null,
  now: number,
): boolean {
  const asked = triedAt(cached, lastTried.observation);
  return asked === null || now - asked >= OBSERVATION_GAP_MS;
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
  const asked = triedAt(cached, lastTried.forecast);
  return asked === null || now - asked >= MIN_GAP_MS;
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

/**
 * When each product was last **asked for**, as opposed to last heard.
 *
 * The gap has to be "time since the last attempt", not "time since the last
 * success" — otherwise an attempt that comes back with nothing leaves the
 * cache's `fetchedAt` where it was and the next publish tries again, and the
 * one after that, forever. That is the firehose this file has already been
 * fixed for once; a station list that is simply absent, or a barn with no
 * signal, would have reintroduced it.
 *
 * **In memory rather than in a column**, deliberately. It is a rate limiter,
 * not a record: one attempt per cold start is right, and a restart should not
 * inherit a backoff. And `fetchedAt` cannot double as this, because the screen
 * shows it — bumping it on a failed attempt would say "last heard just now"
 * about a forecast a day old, which is the exact lie this cache exists to
 * avoid.
 */
const lastTried = { forecast: 0, observation: 0, alerts: 0 };

/** The later of "last heard" and "last asked", which is what a gap runs from. */
function triedAt(cached: { fetchedAt: number } | null, tried: number): number | null {
  if (cached === null && tried === 0) return null;
  return Math.max(cached?.fetchedAt ?? 0, tried);
}

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
  const asked = triedAt(cached, lastTried.forecast);
  if (options.force !== true && asked !== null && now - asked < MIN_GAP_MS) {
    return {
      weather: await readWeather(now),
      ...(known?.grid.placeName === undefined ? {} : { placeName: known.grid.placeName }),
    };
  }

  // Recorded before the request rather than after, so a request that throws
  // still counts as an attempt.
  lastTried.forecast = now;

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
  lastTried.forecast = 0;
  lastTried.observation = 0;
  lastTried.alerts = 0;
  await localStore().writeForecast({ issuedAt: 0, fetchedAt: 0, value: '{}' });
  await localStore().writeObservation({ observedAt: 0, fetchedAt: 0, value: '{}' });
  await localStore().writeAlerts({ fetchedAt: 0, value: '[]' });
}

export type { Forecast, Observation };

// ── official alerts ──────────────────────────────────────────────────────────

/**
 * How often to ask for alerts.
 *
 * Faster than the forecast's hour and faster than the observation's ten
 * minutes would be tempting, but `/alerts/active` is still a network call and
 * this app's promise is that it works with the radio off. Fifteen minutes is
 * the compromise: an alert issued now is on the screen by the next app resume
 * or the next quarter hour, whichever comes first.
 *
 * This is deliberately NOT a substitute for a weather radio, and the screen
 * says so. An app that polls every fifteen minutes must not be the only thing
 * standing between a farm and a tornado.
 */
export const ALERTS_GAP_MS = 15 * 60 * 1000;

/** The live alerts, worst first. Empty when there are none or the set is old. */
export async function readAlerts(now: number = Date.now()): Promise<Alert[]> {
  const cached = await localStore().readAlerts();
  if (cached === null) return [];

  /**
   * An old SET is dropped entirely rather than filtered.
   *
   * Every other cache in this file degrades by showing its age. This one
   * cannot: the absence of an alert in a fresh response is how a cancellation
   * arrives, so a set nobody has refreshed in an hour may contain a warning
   * that was called off fifty minutes ago. Silence is survivable; a lapsed
   * tornado warning presented as live is not.
   */
  if (now - cached.fetchedAt >= ALERTS_STALE_MS) return [];

  const parsed = z.array(alertSchema).safeParse(JSON.parse(cached.value));
  if (!parsed.success) return [];

  return liveAlerts(parsed.data, now);
}

/** Whether a refresh would actually ask. The alerts' own gap. */
export function wouldFetchAlerts(cached: { fetchedAt: number } | null, now: number): boolean {
  const asked = triedAt(cached, lastTried.alerts);
  return asked === null || now - asked >= ALERTS_GAP_MS;
}

/**
 * Fetches the active set if the quarter hour is up, and writes what it got.
 *
 * Same rules as the other two refreshes: never throws, never blocks a screen.
 * **An empty response is written**, unlike a failed one — "no alerts in force"
 * is a real answer and the most common one, and treating it as a failure would
 * leave yesterday's warning on screen on a clear day.
 */
export async function refreshAlerts(
  at: Position,
  options: RefreshOptions = {},
): Promise<Alert[]> {
  const now = options.now ?? Date.now();
  const cached = await localStore().readAlerts();

  const asked = triedAt(cached, lastTried.alerts);
  if (options.force !== true && asked !== null && now - asked < ALERTS_GAP_MS) {
    return readAlerts(now);
  }

  lastTried.alerts = now;

  try {
    const alerts = await fetchAlerts(at);
    await localStore().writeAlerts({ fetchedAt: now, value: JSON.stringify(alerts) });
    return readAlerts(now);
  } catch {
    // Offline, or outside coverage. The last set stands until it goes stale,
    // at which point `readAlerts` stops returning it rather than ageing it.
    return readAlerts(now);
  }
}
