import { readFileSync, writeFileSync } from 'node:fs';
import { nextVersion, withVersion } from './lib/version-bump.mjs';

/**
 * Moves `expo.version`, for the release job to call.
 *
 *   node scripts/release-version.mjs show
 *   node scripts/release-version.mjs patch      0.1.0 -> 0.1.1
 *   node scripts/release-version.mjs minor      0.1.9 -> 0.2.0
 *   node scripts/release-version.mjs major      0.9.3 -> 1.0.0
 *
 * ## Why this exists rather than an `npm version` step
 *
 * `app.json` is hand-maintained and decides the icons, the permissions and the
 * plugins. Round-tripping it through `JSON.parse` and `JSON.stringify` would
 * reformat the whole file on every release — an unreadable diff on the one file
 * where a stray change is expensive. `withVersion` rewrites the characters and
 * leaves everything else exactly as it was.
 *
 * It is also not the package version. Nothing installs this app from a
 * registry; the number that matters is the one Expo stamps into the build and
 * a person reads back off a screen.
 *
 * Prints the old and the new so the job summary can say what shipped, and
 * exits non-zero on anything it will not guess at — a release that renumbered
 * itself wrongly is worse than one that stopped and said so.
 */

const APP_JSON = 'apps/mobile/app.json';
const PARTS = ['major', 'minor', 'patch'];

const part = process.argv[2] ?? 'patch';

let text;
try {
  text = readFileSync(APP_JSON, 'utf8');
} catch {
  console.error(`Could not read ${APP_JSON}. Run this from the top of the checkout.`);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(text);
} catch {
  console.error(`${APP_JSON} is not valid JSON. Fix that first — nothing can build over it.`);
  process.exit(1);
}

if (part === 'show') {
  console.log(parsed.expo?.version ?? '?');
  process.exit(0);
}

if (!PARTS.includes(part)) {
  console.error(`Usage: release-version.mjs {show|${PARTS.join('|')}}`);
  process.exit(1);
}

const { from, to, reason } = nextVersion(parsed, part);
if (to === null) {
  console.error(`expo.version is ${reason}: ${JSON.stringify(from)}. Fix it by hand in ${APP_JSON}.`);
  process.exit(1);
}

const next = withVersion(text, to);
if (next === null) {
  // The parse found it and the text edit did not, which means the file is
  // shaped in a way the pattern does not expect. Refusing beats writing
  // something unpredictable into the file that defines the build.
  console.error(`Could not find "version" in ${APP_JSON} to change.`);
  process.exit(1);
}

writeFileSync(APP_JSON, next, 'utf8');
console.log(`${from} -> ${to}`);
