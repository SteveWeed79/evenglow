import { afterEach, describe, expect, it } from 'vitest';
import { apiBase, apiUrl, resetApiBase, setApiBase } from '@steading/app/api';

/**
 * Which server the transports talk to.
 *
 * Two exist during the migration and they disagree on paths: the browser
 * build calls the Next routes at its own origin, the APK calls the Fastify
 * API at an absolute one. Getting this wrong on device does not look like an
 * error — the WebView serves the app from its own origin, so a relative
 * `/sync` resolves to the bundle and the request simply fails, which from
 * inside the app is indistinguishable from being in a barn with no signal.
 * The queue would back off politely forever.
 */

afterEach(resetApiBase);

describe('same origin (the browser build)', () => {
  it('uses the Next route paths', () => {
    expect(apiUrl('sync')).toBe('/api/sync');
    expect(apiUrl('snapshot')).toBe('/api/pull');
  });

  it('appends a query when there is one', () => {
    expect(apiUrl('snapshot', 'since=42&sinceId=abc')).toBe('/api/pull?since=42&sinceId=abc');
  });

  it('is the default, so a browser build needs no configuration', () => {
    expect(apiBase()).toBeNull();
  });
});

describe('an absolute base (the APK)', () => {
  it('uses the Fastify paths', () => {
    setApiBase('https://farm.example:4000');

    expect(apiUrl('sync')).toBe('https://farm.example:4000/sync');
    expect(apiUrl('snapshot', 'since=0')).toBe('https://farm.example:4000/snapshot?since=0');
  });

  it('tolerates a trailing slash rather than producing a double one', () => {
    // Pasted from a browser bar, this is what you get.
    setApiBase('http://192.168.1.20:4000/');

    expect(apiUrl('sync')).toBe('http://192.168.1.20:4000/sync');
  });

  it('accepts a plain http origin, because a dev machine on a LAN is not https', () => {
    setApiBase('http://10.0.2.2:4000');
    expect(apiUrl('sync')).toBe('http://10.0.2.2:4000/sync');
  });
});

describe('a base that cannot work', () => {
  /**
   * The one that matters. `undefined` stringifies to "undefined" and produces
   * requests to `undefined/sync` — a network error, which the flush loop
   * treats as being offline. It would queue all morning and say "Saved".
   */
  it('refuses a relative path', () => {
    expect(() => setApiBase('/api')).toThrow(/absolute URL/);
  });

  it('refuses an empty string', () => {
    expect(() => setApiBase('')).toThrow(/absolute URL/);
  });

  it('refuses a protocol that is not http or https', () => {
    expect(() => setApiBase('file:///tmp/api')).toThrow(/http or https/);
  });

  it('leaves the previous base alone when it refuses one', () => {
    setApiBase('https://good.example');
    expect(() => setApiBase('nonsense')).toThrow();

    // A half-applied configuration would be worse than either state.
    expect(apiUrl('sync')).toBe('https://good.example/sync');
  });
});
