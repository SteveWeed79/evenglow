import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@steading/contracts';
import { readSite } from '@steading/core/read/growing';
import { enqueue } from '@steading/core/sync/queue';
import { forgetWeather } from '@steading/core/weather';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { resetWeatherState } from '../../apps/mobile/src/weather/store';
import { gps } from '../support/native/modules';
import { navCalls } from '../support/native/navigation';
import { TodayScreen } from '../../apps/mobile/src/screens/TodayScreen';
import { WeatherScreen } from '../../apps/mobile/src/screens/WeatherScreen';

/**
 * The visible half of the forecast.
 *
 * The data layer shipped a round before this did, and the report was "i dont
 * see the weather" — which was correct, and is the reason these exist. A cache
 * nothing renders is not a feature.
 *
 * What is real here: the store, the queue, the contracts, the folding, the row
 * and the screen. Stubbed: the drawing primitives, the GPS, and the service —
 * the last because a suite that reached `api.weather.gov` would be a suite that
 * fails when a government website is slow.
 */

const POINTS = 'https://api.weather.gov/points/44.48,-73.21';
const FORECAST = 'https://api.weather.gov/gridpoints/BTV/50,70/forecast';
const CENSUS = 'https://geocoding.geo.census.gov';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/geo+json' },
  });
}

/**
 * Today sunny, 81/58, 20% — and tomorrow wet, so the two rows differ.
 *
 * Two more weeks the row had never been given, each internally coherent
 * because a fixture that could not happen is a fixture nobody trusts:
 *
 *  - `hot` — a hundred-degree day. Three digits is what wrapped the column.
 *  - `winter` — below freezing, with a signed low and a snow forecast. Between
 *    them they cover both ways `fallsAs` can reach "Snow": the condition
 *    saying so, and a day that never climbs above freezing.
 */
function service(options: { fails?: boolean; hot?: boolean; winter?: boolean } = {}): void {
  const day = new Date();
  day.setHours(12, 0, 0, 0);
  const night = new Date(day.getTime() + 8 * 3600_000);
  const tomorrow = new Date(day.getTime() + 24 * 3600_000);

  vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
    if (options.fails === true) throw new Error('Network request failed');

    if (url.startsWith(CENSUS)) {
      return json({
        result: {
          addressMatches: [
            {
              matchedAddress: '1 FARM RD, HOLLOW, VT, 05401',
              coordinates: { x: -73.212074, y: 44.475881 },
            },
          ],
        },
      });
    }

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
        updated: new Date().toISOString(),
        periods: [
          {
            startTime: day.toISOString(),
            isDaytime: true,
            temperature: options.winter === true ? 28 : options.hot === true ? 100 : 81,
            temperatureUnit: 'F',
            probabilityOfPrecipitation: { value: 20 },
            shortForecast: options.winter === true ? 'Cloudy' : 'Sunny',
          },
          {
            startTime: night.toISOString(),
            isDaytime: false,
            // Twelve below: a signed, four-character low, which with a
            // three-character high is the widest this column can be asked for.
            temperature: options.winter === true ? -12 : options.hot === true ? 78 : 58,
            temperatureUnit: 'F',
            probabilityOfPrecipitation: { value: 20 },
            shortForecast: 'Clear',
          },
          {
            startTime: tomorrow.toISOString(),
            isDaytime: true,
            temperature: options.winter === true ? 30 : 66,
            temperatureUnit: 'F',
            probabilityOfPrecipitation: { value: 80 },
            shortForecast: options.winter === true ? 'Snow Likely' : 'Rain Showers Likely',
          },
        ],
      },
    });
  });
}

/**
 * The rendered text with its spaces removed.
 *
 * `text()` joins every string node with a space, so `{temp}°` — two nodes —
 * comes back as "81 °". That is the harness rather than the screen, and an
 * assertion written around it would be an assertion about the harness.
 */
function tight(said: string): string {
  return said.replace(/\s+/g, '');
}

/** A farm that has said where it is. */
async function sited(): Promise<void> {
  await enqueue({
    entity: 'site',
    op: 'create',
    targetId: newId(),
    payload: { name: 'The farm', lat: 44.48, lon: -73.21, placeName: 'Burlington, VT' },
  });
}

beforeEach(async () => {
  await freshStore();
  await forgetWeather();
  // The forecast state is module-level now, so it outlives a mount.
  resetWeatherState();
  gps.granted = true;
  gps.fixes = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the row on Today', () => {
  it('invites a farm that has never said where it is', async () => {
    service();

    const today = await mount(<TodayScreen />);

    expect(today.text()).toContain('Say where the farm is');
    today.unmount();
  });

  it('shows what it is now, the range, and the chance of rain', async () => {
    service();
    await sited();

    const today = await mount(<TodayScreen />);
    const said = tight(today.text());

    // 81°F high, 58°F low, and 81 for "now" because the fake grid has no
    // hourly product to be more honest with.
    expect(said).toContain('81°');
    expect(said).toContain('58°');
    expect(said).toContain('20%rain');
    today.unmount();
  });

  /** Weather must not push the morning's tally down the screen. */
  it('is one line, above the tallies, and does not displace them', async () => {
    service();
    await sited();
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: newId(),
      payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
    });

    const today = await mount(<TodayScreen />);

    expect(today.has('weather-row')).toBe(true);
    expect(today.text()).toContain('The hens');
    today.unmount();
  });

  /**
   * Past two days the numbers vanish rather than lying. A stale forecast shown
   * as current is worse than none — see FORECAST_STALE_MS.
   */
  it('drops the numbers rather than showing a two-day-old forecast', async () => {
    await sited();
    const old = Date.now() - 5 * 86_400_000;
    vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
      if (url === POINTS) return json({ properties: { forecast: FORECAST } });
      return json({
        properties: {
          updated: new Date(old).toISOString(),
          periods: [
            {
              startTime: new Date(old).toISOString(),
              isDaytime: true,
              temperature: 81,
              temperatureUnit: 'F',
              probabilityOfPrecipitation: { value: 20 },
              shortForecast: 'Sunny',
            },
          ],
        },
      });
    });

    const today = await mount(<TodayScreen />);

    expect(today.text()).toContain('Not heard from the forecast lately');
    expect(tight(today.text())).not.toContain('81°');
    today.unmount();
  });

  it('opens the weather screen when pressed', async () => {
    service();
    await sited();

    const today = await mount(<TodayScreen />);
    await today.press('weather-row');

    expect(navCalls().at(-1)).toMatchObject({ action: 'navigate', route: 'Weather' });
    today.unmount();
  });
});

describe('saying where the farm is', () => {
  it('takes the position from the GPS, rounded on the way in', async () => {
    service();

    const screen = await mount(<WeatherScreen />);
    await screen.press('weather-locate');
    screen.unmount();

    const site = await readSite();
    // The fake reports 44.475881, -73.212074. Nothing anywhere keeps that.
    expect(site?.lat).toBe(44.48);
    expect(site?.lon).toBe(-73.21);
  });

  /**
   * A refused permission is a dead end for the entire feature, and "go to
   * Settings, find the app, find Location" is not an instruction a farm should
   * need. The typed search asks the OS for nothing.
   */
  it('offers the address search when the permission is refused', async () => {
    service();
    gps.granted = false;

    const screen = await mount(<WeatherScreen />);
    await screen.press('weather-locate');

    expect(screen.text()).toContain('Type an address instead');
    // The button that cannot work is withdrawn rather than left to fail again.
    expect(screen.has('weather-locate')).toBe(false);
    expect(screen.has('weather-query')).toBe(true);
    screen.unmount();
  });

  it('does not call a refused permission an error', async () => {
    service();
    gps.fixes = false;

    const screen = await mount(<WeatherScreen />);
    await screen.press('weather-locate');

    expect(screen.text()).toContain('usual indoors');
    // Still offered — stepping outside is the fix, and the button has to be
    // there when they do.
    expect(screen.has('weather-locate')).toBe(true);
    screen.unmount();
  });

  it('writes the position a typed address resolved to', async () => {
    service();

    const screen = await mount(<WeatherScreen />);
    await screen.type('weather-query', '1 Farm Rd, Hollow VT');
    await screen.press('weather-search');
    await screen.press('weather-place-44.48,-73.21');
    screen.unmount();

    const site = await readSite();
    expect(site?.lat).toBe(44.48);
    expect(site?.placeName).toBe('1 FARM RD, HOLLOW, VT, 05401');
  });

  /**
   * `readSite` returns the FIRST site record, so a second create becomes a
   * record nothing reads. A farm that set its position here and its frost
   * dates on the other screen would silently lose one of the two.
   */
  it('updates the site a farm already has rather than making a second one', async () => {
    service();
    await enqueue({
      entity: 'site',
      op: 'create',
      targetId: newId(),
      payload: { name: 'Hollow Farm', rotationYears: 4 },
    });

    const screen = await mount(<WeatherScreen />);
    await screen.press('weather-locate');
    screen.unmount();

    const site = await readSite();
    expect(site?.name).toBe('Hollow Farm');
    expect(site?.rotationYears).toBe(4);
    expect(site?.lat).toBe(44.48);
  });
});

describe('the forecast screen', () => {
  it('lists the days with their highs, lows and chance of rain', async () => {
    service();
    await sited();

    const screen = await mount(<WeatherScreen />);
    const said = tight(screen.text());

    expect(screen.has('weather-day-0')).toBe(true);
    expect(screen.has('weather-day-1')).toBe(true);
    expect(said).toContain('Today');
    expect(said).toContain('81°');
    expect(said).toContain('58°');
    expect(said).toContain('80%');
    screen.unmount();
  });

  /**
   * The rain chance is still announced in words, with the bar gone.
   *
   * A brass bar used to carry that label, and it was scaled to the wettest day
   * of the week rather than to a hundred — so a week topping out at thirty per
   * cent drew a full bar beside the words "30%". Cut on the farm's own reading:
   * *"cut the bar, the % is enough."*
   *
   * The label was the bar's, and this is the half of a deletion that goes
   * quietly wrong. A screen reader was announcing "eighty per cent chance of
   * rain" and would now be reading out "80%" on its own.
   */
  it('still says the chance of rain in words, without the bar to carry it', async () => {
    service();
    await sited();

    const screen = await mount(<WeatherScreen />);
    const labels = screen
      .get('weather-day-1')
      .findAll((node) => typeof node.props['accessibilityLabel'] === 'string')
      .map((node) => String(node.props['accessibilityLabel']));

    expect(labels).toContain('80 per cent chance of rain');
    screen.unmount();
  });

  /**
   * *"The high/low temperatures wrap if the high is 100."*
   *
   * The column was a fixed 76dp — enough for "81° 58°" and nothing longer. It
   * takes the row's spare width now, the width the rain bar was using before it
   * was cut, and refuses to wrap explicitly rather than relying on the space
   * happening to be enough.
   *
   * `numberOfLines` rather than a measurement, because this harness does not
   * lay anything out: what it can hold is the instruction, and a screen that
   * has it cannot fold a temperature onto two lines whatever the font does.
   */
  it('keeps a three-digit high on one line', async () => {
    service({ hot: true });
    await sited();

    const screen = await mount(<WeatherScreen />);
    const said = tight(screen.text());

    expect(said).toContain('100°');
    const temps = screen
      .get('weather-day-0')
      .findAll((node) => typeof node.props['numberOfLines'] === 'number');
    expect(temps.length).toBeGreaterThan(0);
    for (const node of temps) expect(node.props['numberOfLines']).toBe(1);

    screen.unmount();
  });

  it('prints a below-zero low without folding it either', async () => {
    service({ winter: true });
    await sited();

    const screen = await mount(<WeatherScreen />);

    expect(tight(screen.text())).toContain('-12°');
    screen.unmount();
  });
});

/**
 * What the chance is a chance **of**.
 *
 * `rainChance` is `probabilityOfPrecipitation`, so a bare "40%" beside a snow
 * mark left a farm to work out which. Asked plainly: *"how do we handle
 * snow?"* — and the rule is `fallsAs`, covered as arithmetic in
 * `unit/falls-as.test.ts`. These two are the wiring, which is the half this
 * repo keeps shipping at one end only.
 */
describe('rain or snow, on the week', () => {
  it('says rain on a wet day above freezing', async () => {
    service();
    await sited();

    const screen = await mount(<WeatherScreen />);

    expect(tight(screen.text())).toContain('Rain80%');
    screen.unmount();
  });

  it('says snow when snow is what is forecast', async () => {
    service({ winter: true });
    await sited();

    const screen = await mount(<WeatherScreen />);
    const said = tight(screen.text());

    // Tomorrow is forecast snow; today is merely cloudy and never gets above
    // freezing, so both routes to "Snow" are on screen at once.
    expect(said).toContain('Snow80%');
    expect(said).toContain('Snow20%');

    const labels = screen
      .get('weather-day-1')
      .findAll((node) => typeof node.props['accessibilityLabel'] === 'string')
      .map((node) => String(node.props['accessibilityLabel']));
    expect(labels).toContain('80 per cent chance of snow');

    screen.unmount();
  });

  it('says the place it is forecasting for', async () => {
    service();
    await sited();

    const screen = await mount(<WeatherScreen />);
    expect(screen.text()).toContain('Burlington, VT');
    screen.unmount();
  });

  /** The one screen showing numbers the farm did not enter itself. */
  it('always says how old the forecast is', async () => {
    service();
    await sited();

    const screen = await mount(<WeatherScreen />);
    expect(screen.get('weather-age')).toBeDefined();
    // And says WHICH number it is showing. The fake grid lists no observation
    // station, so this falls back to the forecast's figure for the hour — and
    // has to admit that rather than presenting a prediction as a measurement.
    expect(screen.text()).toContain('Forecast for this hour');
    expect(screen.text()).toContain('last heard');
    screen.unmount();
  });

  it('says so honestly when the farm is outside the service area', async () => {
    await enqueue({
      entity: 'site',
      op: 'create',
      targetId: newId(),
      payload: { name: 'The farm', lat: 50.72, lon: -3.53 },
    });
    vi.stubGlobal('fetch', async (): Promise<Response> => {
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    });

    const screen = await mount(<WeatherScreen />);

    expect(screen.text()).toContain('only covers the United States');
    screen.unmount();
  });

  /** No signal is not an error worth a red screen. It is Tuesday in a barn. */
  it('says nothing has arrived yet when there is no signal and no cache', async () => {
    service({ fails: true });
    await sited();

    const screen = await mount(<WeatherScreen />);

    expect(screen.text()).toContain('No forecast has reached this device yet');
    screen.unmount();
  });

  it('offers a way to correct the position once one is set', async () => {
    service();
    await sited();

    const screen = await mount(<WeatherScreen />);

    expect(screen.has('weather-where')).toBe(true);
    await screen.press('weather-where');
    expect(screen.has('weather-query')).toBe(true);
    screen.unmount();
  });
});
