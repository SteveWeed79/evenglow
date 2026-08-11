import { statSync } from 'node:fs';

/**
 * Did the packages move since the last native build?
 *
 * The decision only, with no filesystem assumptions baked in, so it can be
 * tested — which the `node -e` one-liner this replaces never could be. See
 * `scripts/windows/cxx-stale.mjs` for why that mattered.
 */

/** An mtime, or `null` when the path is not there. Never throws. */
export function modifiedAt(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * `.modules.yaml` is rewritten by every install, so it being newer than the
 * native build's cache means the tree moved underneath a configured build.
 * That is the exact condition the Android Gradle Plugin reports as
 *
 *   CMakeLists.txt was modified during checks for C/C++ configuration
 *   invalidation. Before [DELETED], after [LAST_MODIFIED_CHANGED]
 *
 * — a message that blames a file it cannot see change, and that sends people
 * to reinstall, which is the thing that caused it.
 */
export function isStale(installedAt, builtAt) {
  // No native build yet, or no install record to compare it against. There is
  // nothing to invalidate, and guessing would throw away a good build for free.
  if (installedAt === null || builtAt === null) return false;

  // Strictly newer. Equal mtimes happen on a coarse filesystem clock when both
  // were written in the same tick, and clearing a cache on a tie would make
  // every install after a build delete it.
  return installedAt > builtAt;
}
