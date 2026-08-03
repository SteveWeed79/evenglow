import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_UNIT_SYSTEM, type UnitSystem } from '@steading/contracts';
import { readSite } from '@steading/core/read/growing';
import { subscribe } from '@steading/core/sync/engine';
import { readWeather, refreshWeather, type Weather } from '@steading/core/weather';
import { clearTrouble, reportTrouble } from './useTrouble';

/**
 * The forecast, and everything a screen needs to know about not having one.
 *
 * ## Not `useLive`, and that is the point
 *
 * `useLive` returns `null` for "not read yet", and the forecast is nullable in
 * its own right — there is no forecast for a farm that has not said where it
 * is. Passing one through the other collapses the two, and a screen that
 * cannot tell them apart tells somebody they have no weather while it is still
 * looking. That exact shape has already shipped twice (My Farm, the photo
 * strip), so this returns a struct with an explicit `loading` instead.
 *
 * ## The fetch is not a read
 *
 * Every other hook in this app reads the local projection and stops. This one
 * reads the cache and *may also* go to the network — which is a difference
 * worth naming rather than hiding, because it means this hook can be slow
 * where no other one can.
 *
 * It is still cache-first: `weather` is populated from SQLite before any
 * request is made, so a barn with no signal shows the last forecast heard with
 * its age on it. The fetch replaces it when and if one arrives, and never
 * blocks the render. `refreshWeather` throttles to once an hour, so this
 * firing on every engine publish costs a store read, not a request.
 */

export interface WeatherView {
  /** True until the first read of the local cache has answered. */
  loading: boolean;
  /** Where the farm said it is, or null if nobody has said. */
  at: { lat: number; lon: number } | null;
  /** What the farm or the grid lookup called that place. */
  placeName?: string;
  /** The cached forecast, or null when none has ever been fetched. */
  weather: Weather | null;
  /** The farm is outside what the National Weather Service covers. */
  uncovered: boolean;
  /** True while a fetch is in flight, for a screen that wants to say so. */
  fetching: boolean;
  /** Asks again now, ignoring the once-an-hour gap. For a pull-to-refresh. */
  again: () => void;
  units: UnitSystem;
}

const BLANK: Omit<WeatherView, 'again'> = {
  loading: true,
  at: null,
  weather: null,
  uncovered: false,
  fetching: false,
  units: DEFAULT_UNIT_SYSTEM,
};

export function useWeather(): WeatherView {
  const [view, setView] = useState<Omit<WeatherView, 'again'>>(BLANK);

  /**
   * One fetch at a time.
   *
   * The engine publishes after every enqueue, and a farm logging a dozen eggs
   * in ten seconds would otherwise start a dozen overlapping requests that all
   * write the same row. The guard is a ref rather than state because it must
   * be readable and settable within a single tick.
   */
  const busy = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async (force: boolean): Promise<void> => {
    /**
     * A failed read is reported, not thrown.
     *
     * This runs from `subscribe`, where nothing awaits it — a rejection there
     * is an unhandled promise and a silently dead row. `reportTrouble` is what
     * `useLive` does with the same problem, and it puts the reason on the wall
     * rather than leaving a blank space nobody can explain.
     */
    let site: Awaited<ReturnType<typeof readSite>>;
    let cached: Weather | null;
    try {
      site = await readSite();
      // The cache first, always, and before any decision about fetching. A
      // screen must be able to paint from this alone.
      cached = await readWeather();
    } catch (error) {
      reportTrouble('the forecast', error);
      return;
    }

    const units = site?.units ?? DEFAULT_UNIT_SYSTEM;
    const at =
      site?.lat === undefined || site.lon === undefined
        ? null
        : { lat: site.lat, lon: site.lon };

    if (!alive.current) return;
    clearTrouble();

    setView((was) => ({
      ...was,
      loading: false,
      at,
      ...(site?.placeName === undefined ? {} : { placeName: site.placeName }),
      weather: cached,
      units,
    }));

    if (at === null || busy.current) return;
    // Nothing to ask for, or something already asking. Both are ordinary.

    busy.current = true;
    setView((was) => ({ ...was, fetching: true }));

    try {
      const result = await refreshWeather(at, { force });
      if (!alive.current) return;

      setView((was) => ({
        ...was,
        weather: result.weather,
        uncovered: result.uncovered ?? false,
        ...(result.placeName === undefined ? {} : { placeName: result.placeName }),
      }));
    } finally {
      busy.current = false;
      if (alive.current) setView((was) => ({ ...was, fetching: false }));
    }
  }, []);

  useEffect(() => subscribe(() => void load(false)), [load]);

  const again = useCallback(() => {
    void load(true);
  }, [load]);

  return { ...view, again };
}
