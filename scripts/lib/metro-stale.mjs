/**
 * Was Metro's cache written by a different Node?
 *
 * The decision only, with no filesystem in it, so it can be tested — the same
 * split as `cxx-stale.mjs`, and for the same reason.
 */

/**
 * Metro's disk cache is V8-serialized (`node:v8` `serialize`/`deserialize`),
 * and that format is tied to the V8 build that wrote it. Upgrade Node and the
 * old cache becomes unreadable:
 *
 *   Error while reading cache, falling back to a full crawl:
 *    Error: Unable to deserialize cloned data due to invalid or unsupported
 *    version.
 *
 * Fifteen frames of stack for something Metro then recovers from by itself.
 * Nothing is broken — but it costs a full crawl on every start until the cache
 * is replaced, and it prints a wall of red that looks exactly like a fault.
 *
 * Only the major version is compared. V8's serializer format does not change
 * within a patch release, and clearing the cache on every `25.9.0` → `25.9.1`
 * would spend a minute of crawl to avoid a warning that was never coming.
 */
export function majorOf(version) {
  const match = /^v?(\d+)\./.exec(version ?? '');
  return match === null ? null : match[1];
}

/**
 * True when the cache should go.
 *
 * Unknown on either side means leave it alone: a cache that might be fine is
 * worth more than a crawl bought with a guess.
 */
export function cacheIsStale(wroteVersion, runningVersion) {
  const wrote = majorOf(wroteVersion);
  const running = majorOf(runningVersion);
  if (wrote === null || running === null) return false;
  return wrote !== running;
}
