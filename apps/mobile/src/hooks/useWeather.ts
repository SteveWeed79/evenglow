import { useCallback, useSyncExternalStore } from 'react';
import { load, snapshot, watch, type WeatherState } from '../weather/store';

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
 * strip), so this carries an explicit `loading` instead.
 *
 * ## The state is shared, not per-component
 *
 * Three things call this at once — the row on Today, the warning strip beside
 * it, and the weather screen — and when each held its own copy they each held
 * their own fetch as well. See `weather/store.ts` for what that looked like on
 * a handset. This is now a window onto one module-level state, which
 * `useSyncExternalStore` re-renders only when a field genuinely changes.
 */

export type WeatherView = WeatherState & {
  /** Asks again now, ignoring the once-an-hour gap. For a "try again". */
  again: () => void;
};

export function useWeather(): WeatherView {
  const state = useSyncExternalStore(watch, snapshot, snapshot);

  const again = useCallback(() => {
    void load(true);
  }, []);

  return { ...state, again };
}
