import { DEFAULT_UNIT_SYSTEM, type UnitSystem } from '@steading/contracts';
import { readSite } from '@steading/core/read/growing';
import { localStore } from '@steading/core/db/store';
import { subscribe as subscribeToEngine } from '@steading/core/sync/engine';
import { readWeather, refreshWeather, type Weather, wouldFetch } from '@steading/core/weather';
import { clearTrouble, reportTrouble } from '../hooks/useTrouble';

/**
 * The forecast, held once for the whole app.
 *
 * ## Why this is a module and not a hook's `useState`
 *
 * It was a hook, and on a handset it strobed: the "Ask again" button flickered
 * between *Asking…* and *Ask again*, the place name flashed between the street
 * address and the nearest city, and the screen jittered as the layout changed
 * under it. Three separate mistakes, each of which is only visible once
 * something drives the thing quickly.
 *
 * **1. It rode the sync engine's publish.** `subscribe()` from `sync/engine`
 * fires on every enqueue, on every 30-second tick, and immediately for each new
 * subscriber. That is the correct signal for anything read out of the outbox —
 * and the forecast is not in the outbox. It is a cached network value that
 * cannot change more than hourly, wired to a firehose.
 *
 * **2. Three copies were mounted at once.** The row on Today, the warning strip
 * on Today, and the weather screen each called the hook, so each held its own
 * state, its own in-flight guard, and its own fetch. Three states meant three
 * renders per publish and three concurrent requests on a cold cache.
 *
 * **3. Every write allocated a new object**, so React could never bail out —
 * every publish re-rendered every consumer whether or not a single field had
 * changed. That is what turned a logic problem into a visible one.
 *
 * One module-level state, published only when a value actually differs, and a
 * fetch that is decided on before anything says it is fetching. The pattern is
 * `useTrouble`'s, for the same reason: the thing being stored is a fact about
 * the app rather than about one screen.
 */

export interface WeatherState {
  /** True until the first read of the local cache has answered. */
  loading: boolean;
  /** Where the farm said it is, or null if nobody has said. */
  at: { lat: number; lon: number } | null;
  /**
   * What the place is called, or undefined when nothing has named it.
   *
   * Spelled `| undefined` rather than `?:` because "not named" is a state this
   * writes deliberately, and `exactOptionalPropertyTypes` is right that an
   * optional property and a property holding undefined are different things.
   */
  placeName: string | undefined;
  weather: Weather | null;
  /** The farm is outside what the National Weather Service covers. */
  uncovered: boolean;
  /** True only while a request is genuinely in flight. */
  fetching: boolean;
  units: UnitSystem;
}

const BLANK: WeatherState = {
  loading: true,
  at: null,
  placeName: undefined,
  weather: null,
  uncovered: false,
  fetching: false,
  units: DEFAULT_UNIT_SYSTEM,
};

let state: WeatherState = BLANK;
const listeners = new Set<() => void>();

/**
 * Whether two reads describe the same forecast.
 *
 * **Not reference equality**, and that mattered more than it looks: `readWeather`
 * builds a fresh `{ forecast, stale, fetchedAt }` on every call, so comparing
 * by reference said "changed" on every single read and the bail-out below never
 * fired once.
 *
 * Three fields are enough to identify one. The cache holds a single row that is
 * replaced wholesale and never mutated, so a forecast is pinned by the run it
 * came from and the moment this device heard it; `stale` is derived from the
 * first and the clock, and it is the one of the three that can change without
 * anything being re-fetched.
 */
function sameWeather(a: Weather | null, b: Weather | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;

  return (
    a.fetchedAt === b.fetchedAt &&
    a.stale === b.stale &&
    a.forecast.issuedAt === b.forecast.issuedAt
  );
}

function same(a: WeatherState, b: WeatherState): boolean {
  return (
    a.loading === b.loading &&
    a.uncovered === b.uncovered &&
    a.fetching === b.fetching &&
    a.units === b.units &&
    a.placeName === b.placeName &&
    a.weather === b.weather &&
    a.at?.lat === b.at?.lat &&
    a.at?.lon === b.at?.lon
  );
}

function set(next: Partial<WeatherState>): void {
  const merged = { ...state, ...next };

  /**
   * The old forecast object is kept when the new one describes the same run.
   *
   * Not only so the bail-out below can fire: `useWarnings` memoises on
   * `weather`, so an identical re-read that arrived as a new object would
   * recompute every threshold on every engine publish for no reason.
   */
  if (sameWeather(state.weather, merged.weather)) merged.weather = state.weather;

  // The bail-out that makes `useSyncExternalStore` quiet. Without it every
  // publish hands React a new object and every consumer re-renders.
  if (same(state, merged)) return;

  state = merged;
  for (const listener of listeners) listener();
}

/** One load at a time, for the whole app rather than per component. */
let busy = false;

/**
 * Which name the place goes by.
 *
 * **The farm's own always wins**, and getting this wrong is what made the
 * heading flash. There are two names available — the address somebody typed
 * ("1 FARM RD, HOLLOW, VT") and the nearest town the grid lookup reports
 * ("Burlington, VT") — and the old code wrote the first and then the second
 * over the top of it on every single load.
 *
 * The grid's town is a fallback for the farm that used GPS and never named
 * anything, not a correction to a name somebody chose.
 */
function nameOf(sitePlace: string | undefined, gridPlace: string | undefined): string | undefined {
  return sitePlace ?? gridPlace;
}

/** The town the last grid lookup named, kept so it can lose to the site's name. */
let gridPlace: string | undefined;

export async function load(force = false): Promise<void> {
  let site: Awaited<ReturnType<typeof readSite>>;
  let cached: Weather | null;
  let stamp: { fetchedAt: number } | null;

  try {
    site = await readSite();
    // The cache first, always, and before any decision about fetching: a
    // screen must be able to paint from this alone.
    [cached, stamp] = await Promise.all([readWeather(), localStore().readForecast()]);
  } catch (error) {
    reportTrouble('the forecast', error);
    return;
  }

  const at =
    site?.lat === undefined || site.lon === undefined ? null : { lat: site.lat, lon: site.lon };

  set({
    loading: false,
    at,
    placeName: nameOf(site?.placeName, gridPlace),
    weather: cached,
    units: site?.units ?? DEFAULT_UNIT_SYSTEM,
  });
  clearTrouble();

  if (at === null || busy) return;

  /**
   * Decided **before** anything says it is asking.
   *
   * `refreshWeather` already declines to fetch inside the hour, so calling it
   * unconditionally was harmless — except that the screen had by then set
   * "Asking…", and cleared it a millisecond later. Once a publish arrives on
   * every mutation, that is a strobing button rather than an invisible blip.
   */
  if (!force && !wouldFetch(stamp, Date.now())) return;

  busy = true;
  set({ fetching: true });

  try {
    const result = await refreshWeather(at, { force });
    gridPlace = result.placeName;

    set({
      weather: result.weather,
      uncovered: result.uncovered ?? false,
      placeName: nameOf(site?.placeName, gridPlace),
    });
  } finally {
    busy = false;
    set({ fetching: false });
  }
}

/**
 * Watches the projection for a position being set, and nothing more.
 *
 * The subscription is still the engine's, because a position IS a record and
 * the screen has to notice one arriving. What changed is what happens on each
 * publish: a site read and a cache read, both local and both cheap, and a fetch
 * only when the hour is up.
 */
let stop: (() => void) | null = null;

export function watch(listener: () => void): () => void {
  listeners.add(listener);

  if (stop === null) {
    stop = subscribeToEngine(() => {
      void load();
    });
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stop !== null) {
      stop();
      stop = null;
    }
  };
}

export function snapshot(): WeatherState {
  return state;
}

/** Tests only. */
export function resetWeatherState(): void {
  state = BLANK;
  listeners.clear();
  gridPlace = undefined;
  busy = false;
  if (stop !== null) {
    stop();
    stop = null;
  }
}
