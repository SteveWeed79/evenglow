import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@steading/contracts';
import { enqueue } from '@steading/core/sync/queue';
import { forgetWeather } from '@steading/core/weather';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { load, resetWeatherState, snapshot } from '../../apps/mobile/src/weather/store';
import { WeatherScreen } from '../../apps/mobile/src/screens/WeatherScreen';

/**
 * The weather screen holding still.
 *
 * Reported from a handset: *"the weather screen jitters up and down and it
 * keeps cycling the asking / asking again over and over"*, and *"the address
 * screen would flash between the street address and the City name."*
 *
 * Three separate mistakes, none of which the existing tests could see, because
 * every one of them only shows when something drives the hook **repeatedly**
 * and the harness settles a fixed number of ticks and stops.
 *
 *  1. The forecast rode `sync/engine`'s publish, which fires on every enqueue,
 *     every idle tick, and once per new subscriber. A cached network value that
 *     cannot change more than hourly, wired to a firehose.
 *  2. Every attempt set "Asking…" **before** finding out whether the hourly gap
 *     would turn the attempt into a no-op — so each publish lit the button and
 *     cleared it a millisecond later.
 *  3. The place name had two sources and each load wrote both, in order: the
 *     address the farm typed, then the nearest town from the grid lookup over
 *     the top of it.
 *
 * So these tests drive the load directly and repeatedly, which is the thing the
 * device was doing and the harness was not.
 */

const POINTS = 'https://api.weather.gov/points/44.48,-73.21';
const FORECAST = 'https://api.weather.gov/gridpoints/BTV/50,70/forecast';

let asked: string[] = [];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/geo+json' },
  });
}

function service(): void {
  const day = new Date();
  day.setHours(12, 0, 0, 0);

  vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
    asked.push(url);

    if (url === POINTS) {
      return json({
        properties: {
          forecast: FORECAST,
          // The town NWS reports for the grid square — NOT what the farm
          // called the place.
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
            temperature: 70,
            temperatureUnit: 'F',
            probabilityOfPrecipitation: { value: 0 },
            shortForecast: 'Sunny',
          },
        ],
      },
    });
  });
}

/** A farm that typed its address rather than using the GPS. */
async function typedItsAddress(): Promise<void> {
  await enqueue({
    entity: 'site',
    op: 'create',
    targetId: newId(),
    payload: {
      name: 'The farm',
      lat: 44.48,
      lon: -73.21,
      placeName: '1 FARM RD, HOLLOW, VT, 05401',
    },
  });
}

beforeEach(async () => {
  await freshStore();
  await forgetWeather();
  resetWeatherState();
  asked = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('being asked over and over', () => {
  /**
   * The engine publishes on every enqueue. A farm logging a dozen eggs in ten
   * seconds must not make a dozen requests for a value that changes hourly.
   */
  it('asks the service once however many times it is driven', async () => {
    service();
    await typedItsAddress();

    for (let i = 0; i < 20; i += 1) await load();

    expect(asked.filter((url) => url === FORECAST)).toHaveLength(1);
    // And the grid lookup is resolved once too — a farm does not move.
    expect(asked.filter((url) => url === POINTS)).toHaveLength(1);
  });

  /**
   * The strobing button. `fetching` must never be raised for an attempt the
   * hourly gap is going to decline — that is a light going on and off, not a
   * report of anything.
   */
  it('never says it is asking when the hour is not up', async () => {
    service();
    await typedItsAddress();
    await load();

    const seen: boolean[] = [];
    for (let i = 0; i < 10; i += 1) {
      await load();
      seen.push(snapshot().fetching);
    }

    expect(seen.every((fetching) => !fetching)).toBe(true);
  });

  /** Somebody standing at the screen having pressed it is the one exception. */
  it('does ask again when a person presses for it', async () => {
    service();
    await typedItsAddress();
    await load();
    asked = [];

    await load(true);

    expect(asked).toContain(FORECAST);
  });

  /**
   * The bail-out that keeps React quiet. Without it every publish hands
   * `useSyncExternalStore` a new object and every consumer re-renders — which
   * is the jitter, whatever was driving it.
   */
  it('hands out the same state object when nothing has changed', async () => {
    service();
    await typedItsAddress();
    await load();

    const before = snapshot();
    await load();
    await load();

    expect(snapshot()).toBe(before);
  });
});

describe('what the place is called', () => {
  /**
   * Two names exist — the address somebody typed and the nearest town the grid
   * lookup reports — and the farm's own wins. The old code wrote the first and
   * then the second over it on every load, which is the flashing.
   */
  it('keeps the address the farm typed, and never flashes to the grid town', async () => {
    service();
    await typedItsAddress();

    const seen = new Set<string | undefined>();
    for (let i = 0; i < 10; i += 1) {
      await load();
      seen.add(snapshot().placeName);
    }

    expect([...seen]).toEqual(['1 FARM RD, HOLLOW, VT, 05401']);
  });

  /** The grid's town is the fallback for a farm that used GPS and named nothing. */
  it('falls back to the town the grid names when the farm named nothing', async () => {
    service();
    await enqueue({
      entity: 'site',
      op: 'create',
      targetId: newId(),
      payload: { name: 'The farm', lat: 44.48, lon: -73.21 },
    });

    await load();
    expect(snapshot().placeName).toBe('Burlington, VT');

    // And it stays that, rather than alternating with nothing.
    await load();
    await load();
    expect(snapshot().placeName).toBe('Burlington, VT');
  });

  it('shows the name the farm chose on screen, not the grid town', async () => {
    service();
    await typedItsAddress();

    const screen = await mount(<WeatherScreen />);

    expect(screen.text()).toContain('1 FARM RD, HOLLOW, VT');
    expect(screen.text()).not.toContain('Burlington, VT');
    screen.unmount();
  });
});
