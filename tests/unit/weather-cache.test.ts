import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FORECAST_STALE_MS } from '@homefarm/contracts';
import { localStore } from '@homefarm/core/db/store';
import { forgetWeather, readWeather, refreshWeather } from '@homefarm/core/weather';
import { freshStore } from '../support/store';

/**
 * The forecast cache: what a screen reads, and how rarely anything is asked.
 *
 * Two things this proves that matter more than the parsing:
 *
 *  - **A screen never waits for the network.** The cache is written before
 *    anything renders and read on its own. A barn with no signal shows the
 *    last forecast heard, with its age on it, rather than a spinner.
 *  - **A fetch that fails changes nothing.** No thrown error reaches a screen,
 *    and the previous forecast survives — because the alternative is the
 *    weather blanking every time somebody walks into a shed.
 */

const AT = { lat: 44.48, lon: -73.21 };
const POINTS = 'https://api.weather.gov/points/44.48,-73.21';
const FORECAST = 'https://api.weather.gov/gridpoints/BTV/50,70/forecast';

let asked: string[] = [];

/** A service that answers, counting every request. */
function service(options: { fails?: boolean; temperature?: number; issuedAt?: number } = {}): void {
  vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
    asked.push(url);
    if (options.fails === true) throw new Error('Network request failed');

    if (url === POINTS) {
      return json({
        properties: {
          forecast: FORECAST,
          relativeLocation: { properties: { city: 'Burlington', state: 'VT' } },
        },
      });
    }

    return json({
      properties: {
        updated: new Date(options.issuedAt ?? Date.now()).toISOString(),
        periods: [
          {
            startTime: new Date().toISOString(),
            isDaytime: true,
            temperature: options.temperature ?? 72,
            temperatureUnit: 'F',
            probabilityOfPrecipitation: { value: 20 },
            shortForecast: 'Sunny',
          },
        ],
      },
    });
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/geo+json' },
  });
}

beforeEach(async () => {
  await freshStore();
  await forgetWeather();
  asked = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what a screen reads', () => {
  it('is null before anything has ever been fetched', async () => {
    await freshStore();
    expect(await readWeather()).toBeNull();
  });

  it('is the last forecast heard, with when it was heard', async () => {
    service();
    const at = Date.parse('2026-08-03T09:00:00Z');

    await refreshWeather(AT, { now: at });
    const weather = await readWeather(at);

    expect(weather?.forecast.days).toHaveLength(1);
    expect(weather?.fetchedAt).toBe(at);
    expect(weather?.stale).toBe(false);
  });

  /**
   * Past two days it vanishes rather than lying. A stale forecast shown as
   * current is worse than none: it is wrong with a confident number on the one
   * screen this app asks people to trust.
   */
  /**
   * Judged on `issuedAt` — when the service made the run — and not on when this
   * device fetched. A phone in a pocket for a day did not make the forecast
   * older; it just stopped hearing about it, and the last run it heard is still
   * the last run there was. So the service here is pinned to issue at the same
   * moment it is asked.
   */
  it('is marked stale once the run behind it is two days old', async () => {
    const fetched = Date.parse('2026-08-03T09:00:00Z');
    service({ issuedAt: fetched });

    await refreshWeather(AT, { now: fetched });

    expect((await readWeather(fetched + FORECAST_STALE_MS - 1000))?.stale).toBe(false);
    expect((await readWeather(fetched + FORECAST_STALE_MS + 1000))?.stale).toBe(true);
  });

  /** A cache written by an older build is replaced, not rendered half-formed. */
  it('reads a cache it cannot parse as no forecast at all', async () => {
    await localStore().writeForecast({
      issuedAt: Date.now(),
      fetchedAt: Date.now(),
      value: JSON.stringify({ shape: 'from an older build' }),
    });

    expect(await readWeather()).toBeNull();
  });
});

describe('how often anything is asked', () => {
  it('fetches once, then answers from the cache for an hour', async () => {
    service();
    const at = Date.parse('2026-08-03T09:00:00Z');

    await refreshWeather(AT, { now: at });
    const first = asked.length;

    await refreshWeather(AT, { now: at + 60_000 });
    await refreshWeather(AT, { now: at + 30 * 60_000 });

    expect(asked.length).toBe(first);
  });

  it('asks again once the hour is up', async () => {
    service();
    const at = Date.parse('2026-08-03T09:00:00Z');

    await refreshWeather(AT, { now: at });
    const first = asked.length;

    await refreshWeather(AT, { now: at + 61 * 60_000 });

    expect(asked.length).toBeGreaterThan(first);
  });

  /**
   * The gap is checked BEFORE the grid lookup. Otherwise a farm opening the app
   * six times in a morning makes six `/points` requests to decide six times
   * that it already had the answer — the request the cache exists to avoid,
   * moved one step earlier.
   */
  it('does not even resolve the grid when it is going to answer from cache', async () => {
    service();
    const at = Date.parse('2026-08-03T09:00:00Z');

    await refreshWeather(AT, { now: at });
    asked = [];

    await refreshWeather(AT, { now: at + 60_000 });

    expect(asked).toEqual([]);
  });

  /** Somebody is standing at the screen having pressed "try again". */
  it('asks anyway when forced', async () => {
    service();
    const at = Date.parse('2026-08-03T09:00:00Z');

    await refreshWeather(AT, { now: at });
    asked = [];

    await refreshWeather(AT, { now: at + 60_000, force: true });

    expect(asked).toContain(FORECAST);
  });

  /**
   * Forcing must not poison the gap. Skipping the hour by passing a `now` an
   * hour ahead would write a `fetchedAt` in the future, and every later refresh
   * would see a cache that looks fresh for an hour that never elapses.
   */
  it('leaves the gap honest after a forced refresh', async () => {
    service();
    const at = Date.parse('2026-08-03T09:00:00Z');

    await refreshWeather(AT, { now: at });
    await refreshWeather(AT, { now: at + 60_000, force: true });

    const weather = await readWeather(at + 60_000);
    expect(weather?.fetchedAt).toBe(at + 60_000);
  });

  /** The grid never changes for a fixed position, so it is resolved once. */
  it('resolves the grid once and reuses it', async () => {
    service();
    const at = Date.parse('2026-08-03T09:00:00Z');

    await refreshWeather(AT, { now: at });
    await refreshWeather(AT, { now: at + 2 * 3600_000 });

    expect(asked.filter((url) => url === POINTS)).toHaveLength(1);
    expect(asked.filter((url) => url === FORECAST)).toHaveLength(2);
  });

  /**
   * A farm that has corrected its position must not be handed the previous
   * valley's grid square — which is held in memory, where a store wipe does not
   * reach it.
   */
  it('resolves the grid again once the pin has moved', async () => {
    service();
    const at = Date.parse('2026-08-03T09:00:00Z');

    await refreshWeather(AT, { now: at });
    await forgetWeather();
    asked = [];

    await refreshWeather({ lat: 41.88, lon: -87.63 }, { now: at + 60_000 });

    expect(asked.some((url) => url.includes('/points/41.88,-87.63'))).toBe(true);
  });
});

describe('when it cannot be reached', () => {
  it('keeps the last forecast rather than blanking', async () => {
    service();
    const at = Date.parse('2026-08-03T09:00:00Z');
    await refreshWeather(AT, { now: at });

    service({ fails: true });
    const result = await refreshWeather(AT, { now: at + 2 * 3600_000 });

    expect(result.weather?.forecast.days).toHaveLength(1);
    expect(result.uncovered).toBeUndefined();
  });

  it('never throws at the caller, because a screen has nothing to do with it', async () => {
    service({ fails: true });

    await expect(refreshWeather(AT, { now: Date.now() })).resolves.toMatchObject({
      weather: null,
    });
  });

  /** Not transient, and no retry fixes it — so the screen is told, once. */
  it('says so when the farm is outside the service area', async () => {
    vi.stubGlobal('fetch', async (): Promise<Response> => {
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    });

    const result = await refreshWeather({ lat: 50.72, lon: -3.53 }, { now: Date.now() });

    expect(result.uncovered).toBe(true);
    expect(result.weather).toBeNull();
  });
});

describe('the place the grid names', () => {
  it('comes back so a screen can say what position it picked', async () => {
    service();

    const result = await refreshWeather(AT, { now: Date.parse('2026-08-03T09:00:00Z') });

    expect(result.placeName).toBe('Burlington, VT');
  });
});
