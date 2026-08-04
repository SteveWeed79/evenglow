import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALERTS_STALE_MS, alertLive, liveAlerts, type Alert } from '@steading/contracts';
import { ALERTS_GAP_MS, forgetWeather, readAlerts, refreshAlerts } from '@steading/core/weather';
import { localStore } from '@steading/core/db/store';
import { freshStore } from '../support/store';

/**
 * Official watches and warnings.
 *
 * The one surface in this app with an authority behind it, and the one where a
 * stale value is dangerous rather than merely wrong: a tornado warning still
 * on screen an hour after it lapsed teaches a farm that the row does not mean
 * anything, on the row where that lesson is fatal.
 *
 * So the refusals are what is tested hardest. Every other cache here degrades
 * by showing its age; this one goes silent.
 */

const AT = { lat: 39.19, lon: -96.59 };
const NOW = Date.parse('2026-08-05T14:00:00Z');
const HOUR = 3_600_000;

let asked: string[] = [];

function service(features: unknown[], options: { fails?: boolean } = {}): void {
  vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
    asked.push(url);
    if (options.fails === true) throw new Error('Network request failed');

    return new Response(JSON.stringify({ features }), {
      status: 200,
      headers: { 'content-type': 'application/geo+json' },
    });
  });
}

function tornado(over: Record<string, unknown> = {}): unknown {
  return {
    id: 'urn:oid:2.49.0.1.840.0.tornado',
    properties: {
      id: 'urn:oid:2.49.0.1.840.0.tornado',
      event: 'Tornado Warning',
      severity: 'Extreme',
      headline: 'Tornado Warning issued August 5 at 2:00PM CDT',
      description: 'At 200PM CDT, a severe thunderstorm capable of producing a tornado…',
      instruction: 'TAKE COVER NOW. Move to a basement or an interior room.',
      onset: '2026-08-05T14:00:00Z',
      ends: '2026-08-05T15:00:00Z',
      areaDesc: 'Riley County, KS',
      ...over,
    },
  };
}

beforeEach(async () => {
  await freshStore();
  // `lastTried` is module-level and survives a fresh store, so without this
  // every test after the first is inside the previous one's fifteen minutes
  // and silently answers from an empty cache.
  await forgetWeather();
  asked = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reading what the service said', () => {
  it('keeps the instruction, which is the part that matters', async () => {
    service([tornado()]);
    const alerts = await refreshAlerts(AT, { now: NOW });

    expect(alerts[0]?.event).toBe('Tornado Warning');
    expect(alerts[0]?.severity).toBe('extreme');
    expect(alerts[0]?.instruction).toContain('TAKE COVER NOW');
    expect(alerts[0]?.area).toBe('Riley County, KS');
  });

  /** A position identifies a family's home, so it is rounded before it is sent. */
  it('asks about a rounded position', async () => {
    service([]);
    await refreshAlerts({ lat: 39.192_837, lon: -96.591_234 }, { now: NOW });

    expect(asked[0]).toContain('point=39.19,-96.59');
  });

  /**
   * A severity word this app has never seen must not make an alert vanish. An
   * alert it cannot grade is still an alert a meteorologist issued.
   */
  it('keeps an alert whose severity it does not recognise', async () => {
    service([tornado({ severity: 'Catastrophic' })]);
    const alerts = await refreshAlerts(AT, { now: NOW });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.severity).toBe('unknown');
  });

  /** One unusable feature must not take the tornado warning beside it down. */
  it('drops what will not parse and keeps the rest', async () => {
    service([{ properties: { severity: 'Severe' } }, tornado()]);
    const alerts = await refreshAlerts(AT, { now: NOW });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.event).toBe('Tornado Warning');
  });

  it('worst first', async () => {
    service([
      tornado({ id: 'b', event: 'Frost Advisory', severity: 'Minor', ends: undefined }),
      tornado({ id: 'a' }),
    ]);
    const alerts = await refreshAlerts(AT, { now: NOW });

    expect(alerts.map((alert) => alert.event)).toEqual(['Tornado Warning', 'Frost Advisory']);
  });
});

describe('when it stops being true', () => {
  /**
   * The load-bearing one. An alert that has lapsed is not shown, however
   * recently it was fetched.
   */
  it('drops an alert whose end time has passed', async () => {
    service([tornado()]);
    await refreshAlerts(AT, { now: NOW });

    // The warning ended at 15:00. It is now 15:01.
    expect(await readAlerts(NOW + HOUR + 60_000)).toHaveLength(0);
  });

  /**
   * The service omits `ends` on some products, and dropping those would
   * silently hide a whole class of warning. The failure has to fall on the
   * side of showing one too many.
   */
  it('treats an alert with no end time as live', () => {
    const open: Alert = { id: 'a', event: 'Special Weather Statement', severity: 'moderate' };
    expect(alertLive(open, NOW)).toBe(true);
  });

  /**
   * A cancellation arrives as an ABSENCE from the next response, so a set
   * nobody has refreshed may contain a warning called off fifty minutes ago.
   * Silence is survivable; a lapsed tornado warning shown as live is not.
   */
  it('drops the whole set once it is too old to trust', async () => {
    service([tornado({ ends: undefined })]);
    await refreshAlerts(AT, { now: NOW });

    expect(await readAlerts(NOW + ALERTS_STALE_MS - 1000)).toHaveLength(1);
    expect(await readAlerts(NOW + ALERTS_STALE_MS + 1000)).toHaveLength(0);
  });

  /**
   * "No alerts" is a real answer and the common one. Treating an empty
   * response as a failure would leave yesterday's warning up on a clear day.
   */
  it('writes an empty answer, clearing what was there', async () => {
    service([tornado({ ends: undefined })]);
    await refreshAlerts(AT, { now: NOW });
    expect(await readAlerts(NOW)).toHaveLength(1);

    service([]);
    await refreshAlerts(AT, { now: NOW + ALERTS_GAP_MS });
    expect(await readAlerts(NOW + ALERTS_GAP_MS)).toHaveLength(0);
  });
});

describe('how often it asks', () => {
  it('answers from the cache inside the quarter hour', async () => {
    service([tornado()]);
    await refreshAlerts(AT, { now: NOW });
    await refreshAlerts(AT, { now: NOW + 60_000 });

    expect(asked).toHaveLength(1);
  });

  it('asks again once the quarter hour is up', async () => {
    service([tornado()]);
    await refreshAlerts(AT, { now: NOW });
    await refreshAlerts(AT, { now: NOW + ALERTS_GAP_MS + 1000 });

    expect(asked).toHaveLength(2);
  });

  /**
   * A failed fetch leaves the last set alone rather than blanking it — and
   * never throws, because nothing here may reach a screen as an error.
   */
  it('keeps the last set when the network is gone', async () => {
    service([tornado({ ends: undefined })]);
    await refreshAlerts(AT, { now: NOW });

    service([], { fails: true });
    const alerts = await refreshAlerts(AT, { now: NOW + ALERTS_GAP_MS + 1000 });

    expect(alerts).toHaveLength(1);
  });

  /**
   * The firehose this codebase has already been bitten by: a gap measured from
   * the last SUCCESS retries forever when a call keeps failing.
   */
  it('does not retry on every publish when the service is down', async () => {
    service([], { fails: true });
    await refreshAlerts(AT, { now: NOW });
    await refreshAlerts(AT, { now: NOW + 1000 });
    await refreshAlerts(AT, { now: NOW + 2000 });

    expect(asked).toHaveLength(1);
  });
});

describe('sorting', () => {
  it('holds still when two alerts share a severity', () => {
    const one: Alert = { id: 'b', event: 'Flood Watch', severity: 'moderate' };
    const two: Alert = { id: 'a', event: 'Wind Advisory', severity: 'moderate' };

    expect(liveAlerts([one, two], NOW).map((alert) => alert.id)).toEqual(['a', 'b']);
    expect(liveAlerts([two, one], NOW).map((alert) => alert.id)).toEqual(['a', 'b']);
  });
});

describe('signing out', () => {
  /**
   * A cached alert set is *for a position*, and the position is the farm's
   * own — the thing `roundPosition` exists to be careful with. The weather
   * tables were missing from the wipe entirely, so a sign-out left the
   * forecast, the reading and the alerts behind for whoever signed in next.
   */
  it('leaves nothing behind', async () => {
    service([tornado({ ends: undefined })]);
    await refreshAlerts(AT, { now: NOW });

    await localStore().wipe();

    expect(await localStore().readAlerts()).toBeNull();
    expect(await localStore().readForecast()).toBeNull();
    expect(await localStore().readObservation()).toBeNull();
  });
});
