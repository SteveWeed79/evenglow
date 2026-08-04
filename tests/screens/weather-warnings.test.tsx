import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@steading/contracts';
import { enqueue } from '@steading/core/sync/queue';
import { forgetWeather } from '@steading/core/weather';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { TodayScreen } from '../../apps/mobile/src/screens/TodayScreen';

/**
 * The warning strip, against the real store.
 *
 * The thresholds themselves are pinned in `tests/unit/weather-warnings.test.ts`
 * where they need no database. What this proves is the half that only a
 * mounted screen can: that the counts reaching those rules are the right
 * counts — that a bed marked covered is excluded, that a planting still on a
 * windowsill is not "outside", and that a farm with nothing to be warned about
 * gets a screen with nothing on it.
 *
 * That last one is the design. A strip that appears every morning is one
 * nobody reads by the second week, and then it is not read on the morning it
 * matters.
 */

const POINTS = 'https://api.weather.gov/points/44.48,-73.21';
const FORECAST = 'https://api.weather.gov/gridpoints/BTV/50,70/forecast';

const SITE = newId();

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/geo+json' },
  });
}

/** A forecast for today: a high, a low, and optionally a humidity. */
function service(options: { highF: number; lowF: number; humidity?: number }): void {
  const day = new Date();
  day.setHours(12, 0, 0, 0);
  const night = new Date(day.getTime() + 8 * 3600_000);

  vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
    if (url === POINTS) return json({ properties: { forecast: FORECAST } });

    return json({
      properties: {
        updated: new Date().toISOString(),
        periods: [
          {
            startTime: day.toISOString(),
            isDaytime: true,
            temperature: options.highF,
            temperatureUnit: 'F',
            probabilityOfPrecipitation: { value: 0 },
            ...(options.humidity === undefined
              ? {}
              : { relativeHumidity: { value: options.humidity } }),
            shortForecast: 'Sunny',
          },
          {
            startTime: night.toISOString(),
            isDaytime: false,
            temperature: options.lowF,
            temperatureUnit: 'F',
            probabilityOfPrecipitation: { value: 0 },
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
    targetId: SITE,
    payload: { name: 'The farm', lat: 44.48, lon: -73.21 },
  });
}

async function hens(count = 12): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: newId(),
    payload: { name: 'The hens', species: 'chicken', count, purposes: ['eggs'] },
  });
}

/** A bed, and one planting standing in it. */
async function bedWithPlanting(options: { covered: boolean; status?: string }): Promise<void> {
  const bed = newId();
  await enqueue({
    entity: 'bed',
    op: 'create',
    targetId: bed,
    payload: { siteId: SITE, name: 'Bed 3', covered: options.covered },
  });
  await enqueue({
    entity: 'planting',
    op: 'create',
    targetId: newId(),
    payload: {
      bedId: bed,
      varietyId: newId(),
      season: new Date().getFullYear(),
      status: options.status ?? 'in-ground',
    },
  });
}

beforeEach(async () => {
  await freshStore();
  await forgetWeather();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('an ordinary morning', () => {
  it('puts nothing on Today at all', async () => {
    service({ highF: 68, lowF: 48 });
    await sited();
    await hens();
    await bedWithPlanting({ covered: false });

    const today = await mount(<TodayScreen />);

    expect(today.has('weather-warnings')).toBe(false);
    today.unmount();
  });
});

describe('a freezing night', () => {
  it('warns about the drinkers, with the head count that makes it matter', async () => {
    service({ highF: 38, lowF: 24 });
    await sited();
    await hens(12);

    const today = await mount(<TodayScreen />);

    expect(today.has('warning-freeze')).toBe(true);
    expect(today.text()).toContain('Waterers will ice over');
    expect(today.text()).toContain('12 head');
    today.unmount();
  });

  it('warns about what is standing in an uncovered bed', async () => {
    service({ highF: 38, lowF: 24 });
    await sited();
    await bedWithPlanting({ covered: false });

    const today = await mount(<TodayScreen />);

    expect(today.text()).toContain('1 planting in uncovered beds');
    today.unmount();
  });

  /** A tunnel or a frame beats the site's frost dates — that is what it is for. */
  it('does not count a planting under cover', async () => {
    service({ highF: 38, lowF: 24 });
    await sited();
    await bedWithPlanting({ covered: true });

    const today = await mount(<TodayScreen />);

    expect(today.has('warning-frost')).toBe(false);
    today.unmount();
  });

  /**
   * A tray on a windowsill does not care about tonight. `planned` and
   * `started` are not outside yet, and counting them would warn a farm about
   * seedlings it has indoors.
   */
  it('does not count a planting that has not gone out yet', async () => {
    service({ highF: 38, lowF: 24 });
    await sited();
    await bedWithPlanting({ covered: false, status: 'started' });

    const today = await mount(<TodayScreen />);

    expect(today.has('warning-frost')).toBe(false);
    today.unmount();
  });
});

describe('a hot day', () => {
  it('warns about the birds', async () => {
    // 95°F — where heavy breeds begin to die.
    service({ highF: 95, lowF: 70 });
    await sited();
    await hens();

    const today = await mount(<TodayScreen />);

    expect(today.has('warning-heat-poultry')).toBe(true);
    expect(today.text()).toContain('The hens');
    expect(today.text()).toContain('Birds cannot sweat');
    today.unmount();
  });

  /**
   * The humidity reaches the rule through the parser, the cache, and the
   * projection. This is the only test that proves that path end to end — the
   * field is optional the whole way, so a wiring mistake would be silent.
   */
  it('warns about cattle on a humid day, from humidity the service sent', async () => {
    service({ highF: 82, lowF: 65, humidity: 80 });
    await sited();
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: newId(),
      payload: { name: 'The cows', species: 'cattle', count: 4, purposes: ['milk'] },
    });

    const today = await mount(<TodayScreen />);

    expect(today.has('warning-heat-ruminant')).toBe(true);
    expect(today.text()).toContain('The cows');
    today.unmount();
  });

  it('says nothing about cattle when the service sent no humidity', async () => {
    service({ highF: 82, lowF: 65 });
    await sited();
    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: newId(),
      payload: { name: 'The cows', species: 'cattle', count: 4, purposes: ['milk'] },
    });

    const today = await mount(<TodayScreen />);

    expect(today.has('warning-heat-ruminant')).toBe(false);
    today.unmount();
  });
});

describe('a farm that has not said where it is', () => {
  it('is warned about nothing, and told nothing is wrong', async () => {
    service({ highF: 38, lowF: 20 });
    await hens();
    await bedWithPlanting({ covered: false });

    const today = await mount(<TodayScreen />);

    expect(today.has('weather-warnings')).toBe(false);
    // The invitation is still the only weather thing on screen.
    expect(today.text()).toContain('Say where the farm is');
    today.unmount();
  });
});
