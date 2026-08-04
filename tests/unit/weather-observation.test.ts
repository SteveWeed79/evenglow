import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OBSERVATION_STALE_MS } from '@steading/contracts';
import {
  forgetWeather,
  OBSERVATION_GAP_MS,
  readObservation,
  refreshObservation,
} from '@steading/core/weather';
import { freshStore } from '../support/store';

/**
 * What it is doing **now**, measured rather than forecast.
 *
 * Reported from a farm in Kansas: *"the temperature in summer can raise 10
 * degrees in 30 mins."* That is the whole case. The row on Today used to show
 * the hourly product's figure for the current hour — a prediction wearing the
 * label "now" — so on an afternoon that is climbing it could be badly wrong
 * while the app displayed it with a confident numeral, on the one number
 * anybody can check by opening a door.
 *
 * An observation is a reading from a real thermometer at the nearest airfield.
 * ASOS reports every twenty minutes and files a SPECI out of cycle when
 * conditions change sharply, which is to say the mechanism exists precisely
 * for the case this fixes.
 */

const AT = { lat: 39.19, lon: -96.59 };
const POINTS = 'https://api.weather.gov/points/39.19,-96.59';
const FORECAST = 'https://api.weather.gov/gridpoints/TOP/31,80/forecast';
const STATIONS = 'https://api.weather.gov/gridpoints/TOP/31,80/stations';
const LATEST = 'https://api.weather.gov/stations/KMHK/observations/latest';
const SECOND = 'https://api.weather.gov/stations/KFRI/observations/latest';

let asked: string[] = [];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/geo+json' },
  });
}

function reading(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    properties: {
      timestamp: new Date().toISOString(),
      // NWS reports observations in Celsius, not the forecast's Fahrenheit.
      temperature: { value: 36.1 },
      relativeHumidity: { value: 44 },
      heatIndex: { value: 42.2 },
      textDescription: 'Sunny',
      ...over,
    },
  };
}

/** Two stations listed; the nearest can be made to fail. */
function service(options: { nearestDown?: boolean; noStations?: boolean } = {}): void {
  vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
    asked.push(url);

    if (url === POINTS) {
      return json({
        properties: {
          forecast: FORECAST,
          ...(options.noStations === true ? {} : { observationStations: STATIONS }),
        },
      });
    }

    if (url === STATIONS) {
      return json({
        features: [
          { properties: { stationIdentifier: 'KMHK', name: 'Manhattan Regional Airport' } },
          { properties: { stationIdentifier: 'KFRI', name: 'Marshall Army Airfield' } },
        ],
      });
    }

    if (url === LATEST) {
      if (options.nearestDown === true) {
        return new Response('{}', { status: 503 });
      }
      return json(reading());
    }

    if (url === SECOND) return json(reading({ temperature: { value: 35 } }));

    return json({ properties: { periods: [] } });
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

describe('a measured reading', () => {
  it('comes from the nearest station, in the canonical unit', async () => {
    service();

    const measured = await refreshObservation(AT, { now: Date.now() });

    // 36.1°C, reported in Celsius, stored as tenths.
    expect(measured?.observation.tempDeciC).toBe(361);
    expect(measured?.observation.humidity).toBe(44);
    expect(measured?.observation.station).toBe('Manhattan Regional Airport');
    expect(measured?.stale).toBe(false);
  });

  /**
   * The service's own heat index rather than a second implementation of the
   * same arithmetic. 36°C at 44% is 108°F — a different afternoon from 97°F.
   */
  it('keeps what the service says it feels like', async () => {
    service();

    const measured = await refreshObservation(AT, { now: Date.now() });
    expect(measured?.observation.feelsLikeDeciC).toBe(422);
  });

  /**
   * The nearest station is often a small airfield whose AWOS is down for the
   * week. Giving up on it would mean a farm sees no current temperature at all
   * because of an outage forty miles away that nobody is going to fix.
   */
  it('walks past a station that is down', async () => {
    service({ nearestDown: true });

    const measured = await refreshObservation(AT, { now: Date.now() });

    expect(measured?.observation.tempDeciC).toBe(350);
    expect(measured?.observation.station).toBe('Marshall Army Airfield');
  });

  it('is null where the grid lists no stations at all', async () => {
    service({ noStations: true });

    expect(await refreshObservation(AT, { now: Date.now() })).toBeNull();
  });

  /** A station reporting no temperature is reporting nothing this can use. */
  it('skips a station whose thermometer is not reporting', async () => {
    vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
      if (url === POINTS) {
        return json({ properties: { forecast: FORECAST, observationStations: STATIONS } });
      }
      if (url === STATIONS) {
        return json({
          features: [
            { properties: { stationIdentifier: 'KMHK', name: 'Manhattan Regional Airport' } },
            { properties: { stationIdentifier: 'KFRI', name: 'Marshall Army Airfield' } },
          ],
        });
      }
      if (url === LATEST) return json(reading({ temperature: { value: null } }));
      return json(reading({ temperature: { value: 31 } }));
    });

    const measured = await refreshObservation(AT, { now: Date.now() });
    expect(measured?.observation.station).toBe('Marshall Army Airfield');
  });
});

describe('how often it asks', () => {
  /**
   * Ten minutes against the forecast's hour, and the difference is the point:
   * they are two products with two update rates.
   */
  it('asks again after ten minutes, where the forecast would still be waiting', async () => {
    service();
    const at = Date.parse('2026-08-04T14:00:00Z');

    await refreshObservation(AT, { now: at });
    const first = asked.filter((url) => url === LATEST).length;

    await refreshObservation(AT, { now: at + 5 * 60_000 });
    expect(asked.filter((url) => url === LATEST)).toHaveLength(first);

    await refreshObservation(AT, { now: at + OBSERVATION_GAP_MS + 1000 });
    expect(asked.filter((url) => url === LATEST).length).toBeGreaterThan(first);
  });

  /**
   * **The firehose this nearly reintroduced.** A grid with no stations writes
   * nothing, so a gap measured from the last SUCCESS would leave `fetchedAt`
   * untouched and try again on every engine publish — forever. The gap runs
   * from the last attempt instead.
   */
  it('does not keep asking when there is nothing to find', async () => {
    service({ noStations: true });
    const at = Date.parse('2026-08-04T14:00:00Z');

    for (let i = 0; i < 10; i += 1) await refreshObservation(AT, { now: at + i * 1000 });

    // One /points, and no repeat storm behind it.
    expect(asked.filter((url) => url === POINTS)).toHaveLength(1);
  });

  /** Same protection when the network is simply down. */
  it('does not keep asking while there is no signal', async () => {
    vi.stubGlobal('fetch', async (): Promise<Response> => {
      asked.push('attempt');
      throw new Error('Network request failed');
    });
    const at = Date.parse('2026-08-04T14:00:00Z');

    for (let i = 0; i < 10; i += 1) await refreshObservation(AT, { now: at + i * 1000 });

    expect(asked.length).toBeLessThan(3);
  });
});

describe('how old is too old', () => {
  /**
   * Ninety minutes, which is generous against a twenty-minute cycle. The point
   * is not strictness — it is refusing to call something "now" when the
   * station has plainly stopped reporting, so the screen can fall back to the
   * forecast and say which it is showing.
   */
  it('stops being now once the station has gone quiet', async () => {
    const taken = Date.parse('2026-08-04T14:00:00Z');
    vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
      if (url === POINTS) {
        return json({ properties: { forecast: FORECAST, observationStations: STATIONS } });
      }
      if (url === STATIONS) {
        return json({ features: [{ properties: { stationIdentifier: 'KMHK' } }] });
      }
      return json(reading({ timestamp: new Date(taken).toISOString() }));
    });

    await refreshObservation(AT, { now: taken });

    expect((await readObservation(taken + OBSERVATION_STALE_MS - 1000))?.stale).toBe(false);
    expect((await readObservation(taken + OBSERVATION_STALE_MS + 1000))?.stale).toBe(true);
  });

  /**
   * The age is the STATION's, not this device's. A reading fetched a second
   * ago that the station took twenty-five minutes ago is a twenty-five-minute
   * old reading, and on the afternoon this exists for that is the number worth
   * knowing.
   */
  it('is measured from when the station read it, not when we asked', async () => {
    const taken = Date.parse('2026-08-04T14:00:00Z');
    const fetched = taken + 25 * 60_000;

    vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
      if (url === POINTS) {
        return json({ properties: { forecast: FORECAST, observationStations: STATIONS } });
      }
      if (url === STATIONS) {
        return json({ features: [{ properties: { stationIdentifier: 'KMHK' } }] });
      }
      return json(reading({ timestamp: new Date(taken).toISOString() }));
    });

    const measured = await refreshObservation(AT, { now: fetched });
    expect(measured?.observation.at).toBe(taken);
  });
});
