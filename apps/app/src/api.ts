/**
 * Where the sync endpoints live.
 *
 * Two servers exist during the migration and they do not agree on paths. The
 * browser build talks to the Next routes at its own origin (`/api/sync`,
 * `/api/pull`); the APK talks to the Fastify API (D10) at an absolute origin
 * (`/sync`, `/snapshot`). This module is the only place that knows which,
 * so the transports read the same in both builds and S7 deletes one column
 * from one table rather than hunting fetch calls.
 *
 * Configured rather than detected, matching `db/store.ts`: the native entry
 * sets the base at bootstrap, and nothing else has to know a platform exists.
 * That also keeps `import.meta.env` out of the shared modules — it is Vite's,
 * and these files are compiled by webpack too.
 */

export type Endpoint = 'sync' | 'snapshot';

const PATHS: Record<Endpoint, { sameOrigin: string; api: string }> = {
  sync: { sameOrigin: '/api/sync', api: '/sync' },
  snapshot: { sameOrigin: '/api/pull', api: '/snapshot' },
};

/** null means same-origin — the browser build, and the default. */
let base: string | null = null;

/**
 * Points the client at an absolute API origin.
 *
 * Throws on anything that is not an absolute http(s) URL. A base of
 * `undefined` stringifies to `"undefined"` and produces requests to
 * `undefined/sync`, which fail as a network error — indistinguishable, from
 * inside the app, from being in a barn with no signal. The queue would back
 * off politely forever and the sync chip would say the reassuring thing.
 */
export function setApiBase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `API base must be an absolute URL, got ${JSON.stringify(url)}. ` +
        'Set VITE_API_BASE_URL to where the Fastify API is reachable from the device.',
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`API base must be http or https, got ${parsed.protocol}`);
  }

  // Trailing slash removed so joining is plain concatenation and cannot
  // produce a double slash the server may or may not treat as the same route.
  base = url.replace(/\/+$/, '');
}

/** Back to same-origin. Exported for tests. */
export function resetApiBase(): void {
  base = null;
}

export function apiBase(): string | null {
  return base;
}

/**
 * The URL for one endpoint. `query` is the already-encoded string, without
 * the leading `?`.
 */
export function apiUrl(endpoint: Endpoint, query = ''): string {
  const paths = PATHS[endpoint];
  const path = base === null ? paths.sameOrigin : `${base}${paths.api}`;
  return query === '' ? path : `${path}?${query}`;
}
