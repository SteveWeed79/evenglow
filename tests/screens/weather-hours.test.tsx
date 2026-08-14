import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@steading/contracts';
import { enqueue } from '@steading/core/sync/queue';
import { forgetWeather } from '@steading/core/weather';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { resetWeatherState } from '../../apps/mobile/src/weather/store';
import { gps } from '../support/native/modules';
import { WeatherScreen } from '../../apps/mobile/src/screens/WeatherScreen';

/**
 * The next twenty-four hours, and the line above them.
 *
 * **Reported from a handset:** *"the Day text on the scrolling hourly weather
 * is impossible to see on lamplight mode, the font is black, it's there but not
 * visible."*
 *
 * The strip used to render a day name on **every** cell and paint the
 * twenty-three with nothing to say `'transparent'`, so all the cells stayed the
 * same height. Black on every cell means that inline colour never reached the
 * `Text` at all — both branches were lost, `'transparent'` included — and
 * Android's default text colour is black.
 *
 * Nothing in this suite could catch it, and this is the gap: the harness draws
 * with the real theme tokens but has never asserted that a piece of text
 * *carries* one. A `Text` with no colour of its own is not a rendering fault
 * anywhere in this repo's stubs; it is a black word on a handset.
 *
 * So these assert the shape that has no failure mode rather than the colour
 * that did: a cell with nothing to say renders **no text**, and every word that
 * is drawn names its own colour.
 */

const POINTS = 'https://api.weather.gov/points/44.48,-73.21';
const FORECAST = 'https://api.weather.gov/gridpoints/BTV/50,70/forecast';
const HOURLY = 'https://api.weather.gov/gridpoints/BTV/50,70/forecast/hourly';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/geo+json' },
  });
}

/**
 * Twenty-four hours from 6pm, so the window crosses exactly one midnight —
 * the case the day marker exists for, and the one the old code got wrong.
 *
 * Rain on the first hour only, so the other trick on this strip (a dry hour
 * showing nothing) is exercised in both states by the same fixture.
 */
function service(): void {
  const start = new Date();
  start.setHours(18, 0, 0, 0);

  const hourly = Array.from({ length: 30 }, (_, i) => {
    const at = new Date(start.getTime() + i * 3600_000);
    return {
      number: i + 1,
      name: '',
      startTime: at.toISOString(),
      endTime: new Date(at.getTime() + 3600_000).toISOString(),
      isDaytime: at.getHours() > 6 && at.getHours() < 20,
      temperature: 60 + i,
      temperatureUnit: 'F',
      probabilityOfPrecipitation: { value: i === 0 ? 40 : 0 },
      shortForecast: 'Sunny',
    };
  });

  const day = new Date();
  day.setHours(12, 0, 0, 0);
  const night = new Date(day.getTime() + 8 * 3600_000);

  vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
    if (url === POINTS) {
      return json({
        properties: {
          forecast: FORECAST,
          forecastHourly: HOURLY,
          relativeLocation: { properties: { city: 'Burlington', state: 'VT' } },
        },
      });
    }
    if (url === HOURLY) return json({ properties: { periods: hourly } });

    return json({
      properties: {
        periods: [
          {
            number: 1,
            name: 'Today',
            startTime: day.toISOString(),
            endTime: night.toISOString(),
            isDaytime: true,
            temperature: 81,
            temperatureUnit: 'F',
            probabilityOfPrecipitation: { value: 20 },
            shortForecast: 'Sunny',
          },
          {
            number: 2,
            name: 'Tonight',
            startTime: night.toISOString(),
            endTime: new Date(night.getTime() + 12 * 3600_000).toISOString(),
            isDaytime: false,
            temperature: 58,
            temperatureUnit: 'F',
            probabilityOfPrecipitation: { value: 20 },
            shortForecast: 'Clear',
          },
        ],
      },
    });
  });
}

async function sited(): Promise<void> {
  await enqueue({
    entity: 'site',
    op: 'create',
    targetId: newId(),
    payload: { name: 'The farm', lat: 44.48, lon: -73.21, placeName: 'Burlington, VT' },
  });
}

/** Every `Text` node inside the horizontal strip, with its flattened style. */
function wordsInStrip(
  screen: Awaited<ReturnType<typeof mount>>,
): { text: string; color: unknown }[] {
  const strip = screen.get('weather-hours');
  return strip
    .findAllByType('Text' as never)
    .map((node) => {
      const styles = (Array.isArray(node.props.style) ? node.props.style : [node.props.style])
        .filter((s: unknown): s is Record<string, unknown> => typeof s === 'object' && s !== null);
      const color = styles.reduce<unknown>(
        (found, style) => (style['color'] === undefined ? found : style['color']),
        undefined,
      );
      const children = node.props.children;
      return { text: Array.isArray(children) ? children.join('') : String(children ?? ''), color };
    });
}

beforeEach(async () => {
  await freshStore();
  await forgetWeather();
  resetWeatherState();
  gps.granted = true;
  gps.fixes = true;
  service();
  await sited();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the day marker above the hours', () => {
  it('says the day once, where the day changes', async () => {
    const screen = await mount(<WeatherScreen />);

    const days = wordsInStrip(screen).filter((w) =>
      ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].includes(w.text.toUpperCase()),
    );

    // One midnight in the window, so one marker. Twenty-four would be the old
    // behaviour with its paint stripped off — which is exactly what a handset
    // saw.
    expect(days).toHaveLength(1);

    screen.unmount();
  });

  /**
   * A guard rather than a reproduction, and worth saying which.
   *
   * **This one passes against the broken code.** The old strip did name a
   * colour here; the colour was lost somewhere below this seam, on a handset,
   * where nothing in this suite can follow it. The three assertions around it
   * are the ones that fail on the old code.
   *
   * It stays because it covers the neighbouring mistake this repo can still
   * make in a hurry: a `Text` with no colour of its own is not a rendering
   * fault anywhere in these stubs, and is a black word on a phone.
   */
  it('never draws a word without a colour', async () => {
    const screen = await mount(<WeatherScreen />);

    const words = wordsInStrip(screen);
    expect(words.length).toBeGreaterThan(0);

    const unpainted = words.filter((w) => typeof w.color !== 'string');
    expect(unpainted).toEqual([]);

    screen.unmount();
  });

  /**
   * A cell with nothing to say holds its height with an empty row rather than
   * with text painted out. Invisibility that depends on a colour arriving is
   * invisibility with a failure mode; an element that is not there has none.
   */
  it('paints nothing out to hide it', async () => {
    const screen = await mount(<WeatherScreen />);

    const painted = wordsInStrip(screen).filter((w) => w.color === 'transparent');
    expect(painted).toEqual([]);

    screen.unmount();
  });

  /** One wet hour in the fixture, so the dry ones must render no percentage. */
  it('leaves a dry hour blank rather than writing a hidden zero', async () => {
    const screen = await mount(<WeatherScreen />);

    const percentages = wordsInStrip(screen).filter((w) => w.text.endsWith('%'));

    expect(percentages).toHaveLength(1);
    expect(percentages[0]?.text).toBe('40%');

    screen.unmount();
  });
});
