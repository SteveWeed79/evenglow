/**
 * Installs a built APK on the attached emulator, opens it, and says whether
 * it came up.
 *
 * Run by the `smoke` job in `.github/workflows/apk.yml` inside
 * `reactivecircus/android-emulator-runner`, which has booted a device and put
 * `adb` on the path by the time this starts. Everything that decides the
 * verdict is in `./lib/smoke.mjs`, where it is tested; this file only asks the
 * device questions and files what it answered under `--out`, so a failure
 * arrives with a screenshot, the window hierarchy and the log rather than a
 * red cross.
 *
 *   node scripts/apk-smoke.mjs --apk dist/homefarm-0.7.0-51.apk \
 *     --package dev.swbuild.homefarm --out "$RUNNER_TEMP/smoke"
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crashesIn, judge, parsePids, resumedActivity, textsIn } from './lib/smoke.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (argv[at + 1] ?? fallback);
};

const apk = arg('apk');
const pkg = arg('package', 'dev.swbuild.homefarm');
const out = arg('out', 'smoke');
const waitSeconds = Number(arg('wait', '90'));
/**
 * Any one of these on the first screen means the app rendered. A fresh
 * device has no farm, so Today shows its empty panel; the tab bar is there
 * either way.
 */
const expectAny = (arg('expect', 'Today,Nothing to log yet') ?? '').split(',').map((w) => w.trim());

if (apk === null) fail('Give the APK with --apk.');
mkdirSync(out, { recursive: true });

function adb(args, options = {}) {
  return execFileSync('adb', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

function shell(command) {
  try {
    return adb(['shell', command]);
  } catch (error) {
    return typeof error?.stdout === 'string' ? error.stdout : '';
  }
}

function fail(message) {
  process.stderr.write(`\n  ${message}\n\n`);
  process.exit(1);
}

function sleep(ms) {
  execFileSync('sleep', [String(ms / 1000)]);
}

function summary(lines) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${lines.join('\n')}\n\n`);
}

// ── the device, and the app on it ──────────────────────────────────────────

adb(['wait-for-device']);
for (let i = 0; i < 60 && shell('getprop sys.boot_completed').trim() !== '1'; i += 1) sleep(2000);

process.stdout.write(`  installing ${apk}\n`);
adb(['install', '-r', apk], { stdio: ['ignore', 'inherit', 'inherit'] });
adb(['logcat', '-c']);

process.stdout.write(`  launching ${pkg}\n`);
shell(`monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);

/**
 * Wait for the activity to be on top, then for something to be on screen.
 *
 * Two waits rather than one because they end for different reasons: Android
 * resumes the activity as soon as the window exists, and React Native draws
 * into it some seconds later once the bundle has loaded. Polling the
 * hierarchy until an expected word appears is what stops a slow runner from
 * being reported as a blank app.
 */
const deadline = Date.now() + waitSeconds * 1000;
let resumed = null;
while (Date.now() < deadline) {
  resumed = resumedActivity(shell('dumpsys activity activities'));
  if (resumed !== null && resumed.startsWith(`${pkg}/`)) break;
  sleep(2000);
}

let hierarchy = '';
let texts = [];
while (Date.now() < deadline) {
  shell('uiautomator dump /sdcard/smoke.xml >/dev/null 2>&1');
  hierarchy = shell('cat /sdcard/smoke.xml');
  texts = textsIn(hierarchy);
  const lowered = texts.map((t) => t.toLowerCase());
  if (expectAny.some((w) => lowered.some((t) => t.includes(w.toLowerCase())))) break;
  sleep(2000);
}

// ── what it looked like, kept whatever the verdict ─────────────────────────

const pids = parsePids(shell(`pidof ${pkg}`));
const logcat = shell('logcat -d');
writeFileSync(join(out, 'logcat.txt'), logcat);
writeFileSync(join(out, 'hierarchy.xml'), hierarchy);
writeFileSync(join(out, 'dumpsys-activities.txt'), shell('dumpsys activity activities'));
try {
  writeFileSync(join(out, 'screenshot.png'), adb(['exec-out', 'screencap', '-p'], { encoding: 'buffer' }));
} catch {
  process.stderr.write('  (no screenshot: screencap failed)\n');
}

const verdict = judge({ pkg, pids, resumed, crashes: crashesIn(logcat, pkg), texts, expectAny });

if (!verdict.ok) {
  summary(['### The APK did not come up on a device', '', ...verdict.problems.map((p) => `- ${p}`), '', `Screenshot, hierarchy and logcat are in the \`smoke\` artifact.`]);
  process.stderr.write('\n  This APK did not come up on a device:\n\n');
  for (const problem of verdict.problems) process.stderr.write(`    - ${problem}\n`);
  process.stderr.write('\n');
  process.exit(1);
}

summary([`### Opened on a device — \`${resumed}\`, pid ${pids.join(', ')}`, '', `First screen showed ${JSON.stringify(texts.find((t) => expectAny.some((w) => t.toLowerCase().includes(w.toLowerCase()))))}.`]);
process.stdout.write(`  ${resumed} is up (pid ${pids.join(', ')}), first screen rendered.\n`);
