import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@steading/contracts';
import { enqueue } from '@steading/core/sync/queue';
import { forgetWeather } from '@steading/core/weather';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { resetWeatherState } from '../../apps/mobile/src/weather/store';
import { TodayScreen } from '../../apps/mobile/src/screens/TodayScreen';

/**
 * The official alerts, on Today.
 *
 * The cache rules are pinned in `tests/unit/alerts.test.ts`. What only a
 * mounted screen proves is the ordering — that a tornado warning is above the
 * app's own opinion about warm hens — and that the full instruction is
 * reachable without pushing the egg tally off the screen.
 */

const POINTS = 'https://api.weather.gov/points/39.19,-96.59';
const FORECAST = 'https://api.weather.gov/gridpoints/TOP/31,80/forecast';
const ALERTS = 'https://api.weather.gov/alerts/active?point=39.19,-96.59';

const SITE = newId();

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/geo+json' },
  });
}

/** A hot day, so the app's own heat warning fires alongside any alert. */
function service(alerts: unknown[]): void {
  const day = new Date();
  day.setHours(12, 0, 0, 0);
  const night = new Date(day.getTime() + 8 * 3600_000);

  vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
    if (url === ALERTS) return json({ features: alerts });
    if (url === POINTS) return json({ properties: { forecast: FORECAST } });

    return json({
      properties: {
        updated: new Date().toISOString(),
        periods: [
          {
            startTime: day.toISOString(),
            isDaytime: true,
            temperature: 99,
            temperatureUnit: 'F',
            probabilityOfPrecipitation: { value: 0 },
            shortForecast: 'Sunny',
          },
          {
            startTime: night.toISOString(),
            isDaytime: false,
            temperature: 75,
            temperatureUnit: 'F',
            probabilityOfPrecipitation: { value: 0 },
            shortForecast: 'Clear',
          },
        ],
      },
    });
  });
}

function tornado(over: Record<string, unknown> = {}): unknown {
  return {
    id: 'tornado-1',
    properties: {
      id: 'tornado-1',
      event: 'Tornado Warning',
      severity: 'Extreme',
      headline: 'Tornado Warning issued for Riley County',
      description: 'A severe thunderstorm capable of producing a tornado was located…',
      instruction: 'TAKE COVER NOW. Move to a basement or an interior room.',
      areaDesc: 'Riley County, KS',
      ...over,
    },
  };
}

async function farm(): Promise<void> {
  await enqueue({
    entity: 'site',
    op: 'create',
    targetId: SITE,
    payload: { name: 'The farm', lat: 39.19, lon: -96.59 },
  });
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: newId(),
    payload: { name: 'The hens', species: 'chicken', count: 12, purposes: ['eggs'] },
  });
}

beforeEach(async () => {
  await freshStore();
  await forgetWeather();
  resetWeatherState();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('an alert in force', () => {
  it('reaches Today', async () => {
    service([tornado()]);
    await farm();

    const screen = await mount(<TodayScreen />);
    expect(screen.has('weather-alerts')).toBe(true);
    expect(screen.text()).toContain('Tornado Warning');
    expect(screen.text()).toContain('Riley County, KS');
  });

  /**
   * The ordering that matters. The strip below is this app's opinion about the
   * farm's own animals; this is a meteorologist saying a tornado is on the
   * ground, and a farm reading top to bottom must not meet "your hens are
   * warm" first.
   */
  it('sits above the app’s own warnings', async () => {
    service([tornado()]);
    await farm();

    const screen = await mount(<TodayScreen />);
    const words = screen.text();

    // 99°F puts the poultry heat warning on screen too, so both are present
    // and their order is the assertion.
    expect(screen.has('weather-warnings')).toBe(true);
    expect(words.indexOf('Tornado Warning')).toBeLessThan(words.indexOf('The hens'));
  });

  /**
   * Several hundred words of official text cannot go on Today — it would push
   * the tally off the screen — and must not be thrown away, because "TAKE
   * COVER NOW" is not in the headline.
   */
  it('keeps the full instruction one tap away', async () => {
    service([tornado()]);
    await farm();

    const screen = await mount(<TodayScreen />);
    expect(screen.text()).not.toContain('TAKE COVER NOW');

    await screen.press('alert-tornado-1');
    expect(screen.text()).toContain('TAKE COVER NOW');
  });

  /** It polls over a network that may not be there, and says so. */
  it('says where it came from and what it is not', async () => {
    service([tornado()]);
    await farm();

    const screen = await mount(<TodayScreen />);
    expect(screen.text()).toContain('National Weather Service');
    expect(screen.text()).toContain('Not a substitute for a weather radio');
  });
});

describe('an ordinary day', () => {
  /** The common case by a wide margin: nothing in force, nothing drawn. */
  it('draws nothing at all', async () => {
    service([]);
    await farm();

    const screen = await mount(<TodayScreen />);
    expect(screen.has('weather-alerts')).toBe(false);
  });

  /**
   * A farm that has not set a position cannot be asked about, and there is
   * nothing useful to say about that which differs from "no tornado". A row
   * saying so on a clear day is a row ignored on the day it matters.
   */
  it('draws nothing when the farm has no position', async () => {
    service([tornado()]);
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: newId(),
      payload: { name: 'The hens', species: 'chicken', count: 12, purposes: ['eggs'] },
    });

    const screen = await mount(<TodayScreen />);
    expect(screen.has('weather-alerts')).toBe(false);
  });
});
