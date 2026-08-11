import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { cacheIsStale } from '../lib/metro-stale.mjs';

/**
 * Exits 1 when Metro's cache was written by a different major Node, and 0 when
 * it was not — so the caller can clear it with `if errorlevel 1` and no
 * quoting. The same shape as `cxx-stale.mjs`, for the same reason.
 *
 * Records the running version either way, so the next run has something to
 * compare against. A machine that has never run this is not stale — there is
 * nothing to be stale relative to — and gets a note rather than a wipe.
 *
 * Deliberately quiet. This runs inside a window somebody is waiting on, and
 * the whole point is to remove noise rather than add a line about removing it.
 */
const STAMP = join(tmpdir(), 'steading-metro-node.txt');

let wrote = null;
try {
  if (existsSync(STAMP)) wrote = readFileSync(STAMP, 'utf8').trim();
} catch {
  // An unreadable stamp is the same as no stamp: say nothing is stale rather
  // than throwing away a cache because a text file would not open.
}

const stale = cacheIsStale(wrote, process.version);

try {
  mkdirSync(dirname(STAMP), { recursive: true });
  writeFileSync(STAMP, process.version, 'utf8');
} catch {
  // Recording is best effort. Failing to write the stamp costs one repeated
  // check next time, which is cheaper than failing the run over it.
}

process.exit(stale ? 1 : 0);
