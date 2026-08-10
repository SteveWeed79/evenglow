import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@steading/contracts';
import { enqueue } from '@steading/core/sync/queue';
import { forgetWeather } from '@steading/core/weather';
import { freshStore, simulateRestart } from '../support/store';
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

/**
 * "the heat warnings are useful But we have to be able to minimize them all or
 * click an acknowlegment that hides them. Today they take up the entire
 * screen, all day long."
 *
 * Reported from a handset, twice. The answer is not dismissal — the four
 * refusals in `WeatherWarnings` all still hold — but the two things that were
 * actually making it fill the screen are both fixed, and neither of them
 * silences anything.
 */
describe('a strip that does not eat the screen', () => {
  const COUNTIES =
    'Bourbon; Crawford; Cherokee; Benton; Morgan; Miller; Maries; Vernon; St. Clair; ' +
    'Hickory; Camden; Barton; Cedar; Polk; Dallas; Jasper; Dade; Newton; Lawrence; McDonald';

  it('shows a count of counties rather than nineteen of them', async () => {
    service([tornado({ areaDesc: COUNTIES })]);
    await farm();

    const screen = await mount(<TodayScreen />);

    expect(screen.text()).toContain('Bourbon and 19 more');
    // The wall is gone from the collapsed row.
    expect(screen.text()).not.toContain('McDonald');
  });

  it('gives the whole list back when the row is opened', async () => {
    service([tornado({ areaDesc: COUNTIES })]);
    await farm();

    const screen = await mount(<TodayScreen />);
    await screen.press('alert-tornado-1');

    // Nothing was thrown away — it was only not shouted.
    expect(screen.text()).toContain('McDonald');
  });

  /** The acknowledgement is at the bottom of the OPENED row, past the text. */
  it('offers nothing to tap until the alert has been opened', async () => {
    service([tornado()]);
    await farm();

    const screen = await mount(<TodayScreen />);
    expect(screen.has('alert-read-tornado-1')).toBe(false);

    await screen.press('alert-tornado-1');
    expect(screen.has('alert-read-tornado-1')).toBe(true);
  });

  it('collapses a read alert to one line, keeping the event and losing the bulk', async () => {
    service([tornado({ areaDesc: COUNTIES })]);
    await farm();

    const screen = await mount(<TodayScreen />);
    await screen.press('alert-tornado-1');
    await screen.press('alert-read-tornado-1');

    // Still on screen — this is not a dismissal, and a severe warning that has
    // been read is still severe.
    expect(screen.text()).toContain('Tornado Warning');
    // The headline and the coverage are what went.
    expect(screen.text()).not.toContain('issued for Riley County');
    expect(screen.text()).not.toContain('Bourbon and 19 more');
  });

  it('still opens to every word of the official text once read', async () => {
    service([tornado()]);
    await farm();

    const screen = await mount(<TodayScreen />);
    await screen.press('alert-tornado-1');
    await screen.press('alert-read-tornado-1');
    await screen.press('alert-tornado-1');

    expect(screen.text()).toContain('TAKE COVER NOW');
  });

  /**
   * The property that stops this becoming a reflex that hides real weather.
   * Acknowledgement is keyed to the service's own id, so tomorrow's warning —
   * or an upgrade from watch to warning — is a different product and arrives
   * at full size.
   */
  it('does not carry over to a different alert', async () => {
    service([tornado()]);
    await farm();

    const first = await mount(<TodayScreen />);
    await first.press('alert-tornado-1');
    await first.press('alert-read-tornado-1');
    first.unmount();

    resetWeatherState();
    await forgetWeather();
    service([tornado({ id: 'tornado-2', headline: 'A second Tornado Warning' })]);

    const next = await mount(<TodayScreen />);
    expect(next.text()).toContain('A second Tornado Warning');
  });

  /** It survives the app being closed, or it is not worth storing at all. */
  it('remembers across a restart', async () => {
    service([tornado()]);
    await farm();

    const screen = await mount(<TodayScreen />);
    await screen.press('alert-tornado-1');
    await screen.press('alert-read-tornado-1');
    screen.unmount();

    await simulateRestart();
    resetWeatherState();
    service([tornado()]);

    const after = await mount(<TodayScreen />);
    expect(after.text()).toContain('Tornado Warning');
    expect(after.text()).not.toContain('issued for Riley County');
  });
});
