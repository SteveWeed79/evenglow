import { readFileSync, writeFileSync } from 'node:fs';
import { nextVersionCode, withVersionCode } from '../lib/version-bump.mjs';

/**
 * The parts of "build the app" that are not a command.
 *
 *   node build-app.mjs bump      move expo.android.versionCode on by one
 *   node build-app.mjs show      print version and versionCode
 *   node build-app.mjs artifact  print the newest finished build's APK url
 *
 * **Node does the reading and the editing rather than the batch file.** JSON in
 * `for /f` is the shape of problem that produced the `:ensure_packages` story
 * in `_shared.bat` — a snippet parsed twice, quoting that did not survive, and
 * a routine that never ran once. A file and an exit code have nothing to quote.
 */

const APP_JSON = 'apps/mobile/app.json';

function read(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    console.error(`Could not read ${path}. Run this from the top of the checkout.`);
    process.exit(1);
  }
}

const command = process.argv[2];

if (command === 'show' || command === 'bump') {
  const text = read(APP_JSON);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error(`${APP_JSON} is not valid JSON. Fix that first — nothing can build over it.`);
    process.exit(1);
  }

  if (command === 'show') {
    const android = parsed.expo?.android ?? {};
    console.log(`${parsed.expo?.version ?? '?'}  versionCode ${android.versionCode ?? '(not set)'}`);
    process.exit(0);
  }

  const { from, to, reason } = nextVersionCode(parsed);
  if (to === null) {
    console.error(`versionCode is ${reason}: ${JSON.stringify(from)}. Fix it by hand in ${APP_JSON}.`);
    process.exit(1);
  }

  if (from === null) {
    console.error(
      `versionCode is ${reason}.\n` +
        `Add "versionCode": ${to} to expo.android in ${APP_JSON} — this cannot ` +
        'insert a key without reformatting the file.',
    );
    process.exit(1);
  }

  const next = withVersionCode(text, to);
  if (next === null) {
    console.error(`Could not find versionCode in ${APP_JSON} to change.`);
    process.exit(1);
  }

  writeFileSync(APP_JSON, next, 'utf8');
  console.log(`${from} -> ${to}`);
  process.exit(0);
}

if (command === 'artifact') {
  /**
   * The newest finished build's APK, from eas-cli's own JSON.
   *
   * Read rather than asked for, because the alternative is somebody copying a
   * url out of a terminal by hand — the same class of transcription this
   * project keeps removing, and the one place a wrong character produces a
   * download of somebody else's build rather than an error.
   */
  const { execFileSync } = await import('node:child_process');

  let raw;
  try {
    raw = execFileSync(
      'pnpm',
      [
        '--filter',
        '@homefarm/mobile',
        'exec',
        'eas',
        'build:list',
        '--platform',
        'android',
        '--status',
        'finished',
        '--limit',
        '1',
        '--json',
        '--non-interactive',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    console.error('Could not ask EAS for the build list. Are you signed in? pnpm --filter @homefarm/mobile exec eas login');
    process.exit(1);
  }

  // eas-cli prints the array on its own line; anything else on stdout is noise
  // from the workspace runner and must not be parsed as the answer.
  const start = raw.indexOf('[');
  let builds;
  try {
    builds = JSON.parse(raw.slice(start === -1 ? 0 : start));
  } catch {
    console.error('EAS answered something this could not read.');
    process.exit(1);
  }

  const url = builds?.[0]?.artifacts?.buildUrl ?? builds?.[0]?.artifacts?.applicationArchiveUrl;
  if (typeof url !== 'string' || url === '') {
    console.error('That build has no downloadable artefact. It may still be running, or it expired.');
    process.exit(1);
  }

  console.log(url);
  process.exit(0);
}

console.error('Usage: build-app.mjs {show|bump|artifact}');
process.exit(2);
