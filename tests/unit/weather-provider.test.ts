import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchForecast,
  findGrid,
  findPlace,
  OutsideCoverageError,
} from '@steading/core/weather/provider';

/**
 * The National Weather Service, parsed.
 *
 * **These are recordings, not live calls.** The bodies below are the shapes
 * `api.weather.gov` returns, trimmed to the fields this app reads. That is a
 * real limit and it is stated rather than hidden: a test written against a
 * recording proves the parsing is right about the shape it was given, and
 * proves nothing about the day the service changes shape. What it does catch —
 * and what nothing else can — is the folding, which is where every bug in a
 * weather client lives.
 *
 * The folding is the interesting part. NWS does not publish days. It publishes
 * alternating half-days — "Today", "Tonight", "Monday", "Monday Night" — and a
 * farm reads a day. Pairing them wrong shows a high of 34 in July, and nothing
 * about that looks like a crash.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const GRID = { forecastUrl: 'https://api.weather.gov/gridpoints/BTV/50,70/forecast' };

/** Answers each URL with a canned body, and records what was asked. */
function service(routes: Record<string, unknown>, status = 200): { asked: string[] } {
  const asked: string[] = [];

  vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
    asked.push(url);
    const body = routes[url];
    if (body === undefined) {
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/geo+json' },
    });
  });

  return { asked };
}

function period(over: Record<string, unknown>): Record<string, unknown> {
  return {
    startTime: '2026-08-03T06:00:00-04:00',
    isDaytime: true,
    temperature: 72,
    temperatureUnit: 'F',
    probabilityOfPrecipitation: { value: 0 },
    shortForecast: 'Sunny',
    ...over,
  };
}

describe('finding the grid', () => {
  it('resolves a position to a forecast URL and names the place', async () => {
    const { asked } = service({
      'https://api.weather.gov/points/44.48,-73.21': {
        properties: {
          forecast: 'https://api.weather.gov/gridpoints/BTV/50,70/forecast',
          forecastHourly: 'https://api.weather.gov/gridpoints/BTV/50,70/forecast/hourly',
          relativeLocation: { properties: { city: 'Burlington', state: 'VT' } },
        },
      },
    });

    const grid = await findGrid({ lat: 44.48, lon: -73.21 });

    expect(grid.forecastUrl).toContain('/gridpoints/BTV/50,70/forecast');
    expect(grid.hourlyUrl).toContain('/hourly');
    expect(grid.placeName).toBe('Burlington, VT');
    expect(asked).toHaveLength(1);
  });

  /**
   * The rounding is not decoration. `roundPosition` promises the app never
   * holds better than about a kilometre, and a lookup that sent six decimals
   * would have handed the precise position to a third party regardless of what
   * SQLite stored.
   */
  it('rounds the position before it asks anybody', async () => {
    const { asked } = service({
      'https://api.weather.gov/points/44.48,-73.21': {
        properties: { forecast: 'https://api.weather.gov/f' },
      },
    });

    await findGrid({ lat: 44.475881, lon: -73.212074 });

    expect(asked[0]).toBe('https://api.weather.gov/points/44.48,-73.21');
    expect(asked[0]).not.toContain('44.4758');
  });

  /**
   * The one failure worth a name, because no retry fixes it. A farm in Devon
   * is not offline — it is outside what this service covers, and the screen has
   * to say so rather than showing an empty box for ever.
   */
  it('names being outside the United States, rather than reporting a failure', async () => {
    service({});

    await expect(findGrid({ lat: 50.72, lon: -3.53 })).rejects.toBeInstanceOf(
      OutsideCoverageError,
    );
  });
});

describe('folding half-days into days', () => {
  it('takes the high from the day and the low from the night that follows it', async () => {
    service({
      [GRID.forecastUrl]: {
        properties: {
          updated: '2026-08-03T09:00:00+00:00',
          periods: [
            period({ startTime: '2026-08-03T06:00:00-04:00', temperature: 81, shortForecast: 'Sunny' }),
            period({
              startTime: '2026-08-03T18:00:00-04:00',
              isDaytime: false,
              temperature: 58,
              shortForecast: 'Clear',
            }),
          ],
        },
      },
    });

    const forecast = await fetchForecast(GRID, Date.parse('2026-08-03T10:00:00-04:00'));

    expect(forecast.days).toHaveLength(1);
    // 81°F and 58°F, in tenths of a degree Celsius.
    expect(forecast.days[0]?.highDeciC).toBe(272);
    expect(forecast.days[0]?.lowDeciC).toBe(144);
  });

  /**
   * The app is opened in the evening as often as in the morning, and NWS then
   * returns "Tonight" first. Pairing by position would give that night's low to
   * the following day and shift every reading by half a day.
   */
  it('handles a list that starts with a night', async () => {
    service({
      [GRID.forecastUrl]: {
        properties: {
          periods: [
            period({
              startTime: '2026-08-03T19:00:00-04:00',
              isDaytime: false,
              temperature: 55,
              shortForecast: 'Partly Cloudy',
            }),
            period({
              startTime: '2026-08-04T06:00:00-04:00',
              temperature: 79,
              shortForecast: 'Sunny',
            }),
            period({
              startTime: '2026-08-04T18:00:00-04:00',
              isDaytime: false,
              temperature: 61,
              shortForecast: 'Clear',
            }),
          ],
        },
      },
    });

    const forecast = await fetchForecast(GRID, Date.parse('2026-08-03T20:00:00-04:00'));

    expect(forecast.days).toHaveLength(2);
    /**
     * Tonight, on its own: the half that was forecast, and nothing standing in
     * for the half that was not.
     *
     * This used to fill the high from the low, which read on screen as "79°
     * 79°" — a flat day nobody forecast, and one no screen could contradict
     * because an equal high and low is an ordinary value. Reported from a
     * handset as *"the weather for today shows only the low? it's odd it shows
     * 79 79"*.
     */
    expect(forecast.days[0]?.lowDeciC).toBe(128);
    expect(forecast.days[0]?.highDeciC).toBeUndefined();
    // A night with no day beside it still needs naming.
    expect(forecast.days[0]?.condition).toBe('cloud');
    // Tomorrow, paired properly.
    expect(forecast.days[1]?.highDeciC).toBe(261);
    expect(forecast.days[1]?.lowDeciC).toBe(161);
  });

  it('names the day after its daytime sky, not its night', async () => {
    service({
      [GRID.forecastUrl]: {
        properties: {
          periods: [
            period({ startTime: '2026-08-03T06:00:00-04:00', shortForecast: 'Sunny' }),
            period({
              startTime: '2026-08-03T18:00:00-04:00',
              isDaytime: false,
              shortForecast: 'Rain Showers Likely',
            }),
          ],
        },
      },
    });

    const forecast = await fetchForecast(GRID, Date.parse('2026-08-03T10:00:00-04:00'));

    // "Cloudy" or "raining" from a night period describes hours nobody worked in.
    expect(forecast.days[0]?.condition).toBe('clear');
  });

  /** A forty per cent chance overnight is still a reason to bring something in. */
  it('takes the higher chance of rain across the two halves', async () => {
    service({
      [GRID.forecastUrl]: {
        properties: {
          periods: [
            period({
              startTime: '2026-08-03T06:00:00-04:00',
              probabilityOfPrecipitation: { value: 10 },
            }),
            period({
              startTime: '2026-08-03T18:00:00-04:00',
              isDaytime: false,
              probabilityOfPrecipitation: { value: 70 },
            }),
          ],
        },
      },
    });

    const forecast = await fetchForecast(GRID, Date.parse('2026-08-03T10:00:00-04:00'));
    expect(forecast.days[0]?.rainChance).toBe(70);
  });

  /** NWS sends `null` for "no chance stated", which is not the same as zero. */
  it('reads a missing chance as none rather than as NaN', async () => {
    service({
      [GRID.forecastUrl]: {
        properties: {
          periods: [period({ probabilityOfPrecipitation: { value: null } })],
        },
      },
    });

    const forecast = await fetchForecast(GRID, Date.now());
    expect(forecast.days[0]?.rainChance).toBe(0);
  });

  it('stops at seven days however many periods arrive', async () => {
    const periods = Array.from({ length: 28 }, (_, index) =>
      period({
        startTime: new Date(Date.parse('2026-08-03T06:00:00Z') + index * 43_200_000).toISOString(),
        isDaytime: index % 2 === 0,
      }),
    );

    service({ [GRID.forecastUrl]: { properties: { periods } } });

    const forecast = await fetchForecast(GRID, Date.parse('2026-08-03T10:00:00Z'));
    expect(forecast.days).toHaveLength(7);
  });
});

/**
 * NWS describes the sky in prose rather than with a code, so this matches
 * words — and the order matters. "Chance Showers And Thunderstorms" contains
 * both "showers" and "thunderstorms", and the storm is the one that changes
 * what somebody does with the animals.
 */
describe('reading the sky from what it is called', () => {
  const cases: [string, string][] = [
    ['Sunny', 'clear'],
    ['Mostly Clear', 'clear'],
    ['Partly Cloudy', 'cloud'],
    ['Overcast', 'cloud'],
    ['Patchy Fog', 'fog'],
    ['Light Drizzle', 'drizzle'],
    ['Rain Showers Likely', 'rain'],
    ['Chance Showers And Thunderstorms', 'storm'],
    ['Snow Likely', 'snow'],
    ['Freezing Rain', 'snow'],
    ['Blowing Snow', 'snow'],
  ];

  for (const [said, expected] of cases) {
    it(`reads "${said}" as ${expected}`, async () => {
      service({
        [GRID.forecastUrl]: { properties: { periods: [period({ shortForecast: said })] } },
      });

      const forecast = await fetchForecast(GRID, Date.now());
      expect(forecast.days[0]?.condition).toBe(expected);
    });
  }
});

describe('the hourly half', () => {
  const HOURLY = 'https://api.weather.gov/gridpoints/BTV/50,70/forecast/hourly';
  const withHourly = { ...GRID, hourlyUrl: HOURLY };

  function hours(times: string[]): Record<string, unknown> {
    return {
      properties: {
        periods: times.map((startTime) =>
          period({ startTime, temperature: 68, probabilityOfPrecipitation: { value: 20 } }),
        ),
      },
    };
  }

  /**
   * The strip used to stop at local midnight, and reported from a handset:
   * *"under The rest of today it literally stops at 11pm."* Correct to its own
   * label, and empty at the hour somebody is deciding whether to cover a bed.
   *
   * It rolls a day forward now. The window is what is asserted here — that it
   * carries on past midnight, and that it does not carry on for a week.
   */
  it('carries on past midnight rather than emptying out over the evening', async () => {
    service({
      [GRID.forecastUrl]: { properties: { periods: [period({})] } },
      [HOURLY]: hours([
        '2026-08-03T22:00:00Z',
        '2026-08-03T23:00:00Z',
        '2026-08-04T02:00:00Z',
        '2026-08-04T09:00:00Z',
      ]),
    });

    const forecast = await fetchForecast(withHourly, Date.parse('2026-08-03T21:30:00Z'));

    // All four, including the two after midnight. Under the old rule an
    // evening like this one kept two and then stopped.
    expect(forecast.hours).toHaveLength(4);
  });

  it('stops well short of a week, which is the daily view’s question', async () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      new Date(Date.parse('2026-08-03T14:00:00Z') + index * 3_600_000).toISOString(),
    );
    service({
      [GRID.forecastUrl]: { properties: { periods: [period({})] } },
      [HOURLY]: hours(many),
    });

    const forecast = await fetchForecast(withHourly, Date.parse('2026-08-03T13:30:00Z'));

    expect(forecast.hours).toHaveLength(24);
  });

  it('still drops hours that have already gone', async () => {
    service({
      [GRID.forecastUrl]: { properties: { periods: [period({})] } },
      [HOURLY]: hours(['2026-08-03T09:00:00Z', '2026-08-03T14:00:00Z']),
    });

    // Opened at one o'clock: "rain at 9am" is a lie about the afternoon.
    const forecast = await fetchForecast(withHourly, Date.parse('2026-08-03T13:30:00Z'));

    expect(forecast.hours).toHaveLength(1);
    expect(forecast.hours[0]?.at).toBe(Date.parse('2026-08-03T14:00:00Z'));
  });

  /**
   * A cached forecast read four hours later still carries the morning's hours.
   * "Rain at 9am" on a screen opened at one o'clock is a lie about the
   * afternoon, and the cache is meant to be read hours after it was fetched.
   */
  it('drops hours that have already been', async () => {
    service({
      [GRID.forecastUrl]: { properties: { periods: [period({})] } },
      [HOURLY]: hours([
        '2026-08-03T09:00:00Z',
        '2026-08-03T13:00:00Z',
        '2026-08-03T17:00:00Z',
      ]),
    });

    const forecast = await fetchForecast(withHourly, Date.parse('2026-08-03T13:30:00Z'));

    expect(forecast.hours).toHaveLength(2);
    expect(forecast.hours[0]?.at).toBe(Date.parse('2026-08-03T13:00:00Z'));
  });

  /** The daily list is the feature. The optional half timing out must not cost it. */
  it('still returns the week when the hourly product fails', async () => {
    service({ [GRID.forecastUrl]: { properties: { periods: [period({})] } } });

    const forecast = await fetchForecast(withHourly, Date.now());

    expect(forecast.days).toHaveLength(1);
    expect(forecast.hours).toEqual([]);
  });

  /**
   * The daily "Today" period carries the day's HIGH. A phone opened at seven in
   * the morning would say 81° when it is 58° outside — the one number on the
   * row somebody can check by opening a door.
   */
  it('takes what it is doing now from the current hour, not from the day high', async () => {
    service({
      [GRID.forecastUrl]: {
        properties: { periods: [period({ temperature: 81, shortForecast: 'Sunny' })] },
      },
      [HOURLY]: {
        properties: {
          periods: [
            period({
              startTime: '2026-08-03T07:00:00-04:00',
              temperature: 58,
              shortForecast: 'Patchy Fog',
            }),
          ],
        },
      },
    });

    const forecast = await fetchForecast(withHourly, Date.parse('2026-08-03T07:10:00-04:00'));

    expect(forecast.now.tempDeciC).toBe(144);
    expect(forecast.now.condition).toBe('fog');
  });

  it('falls back to the daily period where there is no hourly product', async () => {
    service({
      [GRID.forecastUrl]: {
        properties: { properties: {}, periods: [period({ temperature: 81 })] },
      },
    });

    const forecast = await fetchForecast(GRID, Date.now());
    expect(forecast.now.tempDeciC).toBe(272);
  });
});

describe('the address search', () => {
  it('rounds what the geocoder returns, and reads x as longitude', async () => {
    vi.stubGlobal('fetch', async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          result: {
            addressMatches: [
              {
                matchedAddress: '1 FARM RD, HOLLOW, VT, 05401',
                // x is longitude and y is latitude — the opposite order to how
                // everything else in this codebase says it.
                coordinates: { x: -73.212074, y: 44.475881 },
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const [place] = await findPlace('1 Farm Rd, Hollow VT');

    expect(place?.name).toBe('1 FARM RD, HOLLOW, VT, 05401');
    expect(place?.lat).toBe(44.48);
    expect(place?.lon).toBe(-73.21);
  });

  it('returns nothing for an address that matched nothing', async () => {
    vi.stubGlobal('fetch', async (): Promise<Response> => {
      return new Response(JSON.stringify({ result: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    expect(await findPlace('nowhere at all')).toEqual([]);
  });
});
