import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { withVersionCode } from './lib/version-bump.mjs';
import { chooseVersionCode, releaseTag, shippedCodes } from './lib/apk.mjs';

/**
 * Decides what this APK is called and stamps the number into `app.json`.
 *
 *   git tag --list 'v*' | node scripts/apk-plan.mjs
 *   git tag --list 'v*' | node scripts/apk-plan.mjs --code 24
 *   APK_VERSION_CODE=24 git tag --list 'v*' | node scripts/apk-plan.mjs
 *
 * The environment form is what the workflow uses. `${{ inputs.… }}` inside a
 * `run:` is textual substitution rather than an argument, so a value that
 * arrives from a form should not be pasted into a shell line — the same reason
 * the checks further on take their values through `env:`.
 *
 * Tags arrive on stdin rather than being fetched here, so the decision stays
 * testable and the network stays in the workflow where it belongs.
 *
 * Writes `versionCode` into `apps/mobile/app.json` **in the working copy only**
 * — `expo prebuild` reads it from there and `android/` is generated and
 * gitignored, so nothing is committed and nothing is left behind.
 *
 * `withVersionCode` rather than `JSON.parse` and re-stringify, for the reason
 * that function gives: `app.json` is hand-maintained and decides the icons, the
 * permissions and the plugins, so round-tripping it would reformat the one file
 * where an unreadable diff is expensive.
 *
 * Everything it decided goes to `$GITHUB_OUTPUT` when there is one, and to
 * stdout always, so it is the same command locally and on a runner.
 */

const APP_JSON = 'apps/mobile/app.json';

function fail(message) {
  process.stderr.write(`\n  ${message}\n\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const at = argv.indexOf('--code');
const override = at === -1 ? (process.env.APK_VERSION_CODE ?? null) : argv[at + 1];

const tags = readFileSync(0, 'utf8').split('\n').filter((line) => line.trim() !== '');

const text = readFileSync(APP_JSON, 'utf8');
const version = JSON.parse(text)?.expo?.version;
if (typeof version !== 'string') fail(`No expo.version in ${APP_JSON}.`);

let decision;
try {
  decision = chooseVersionCode({ shipped: shippedCodes(tags), override });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const stamped = withVersionCode(text, decision.code);
if (stamped === null) fail(`No "versionCode" to rewrite in ${APP_JSON}.`);
writeFileSync(APP_JSON, stamped);

const tag = releaseTag(version, decision.code);
const apk = `steading-${version}-${decision.code}.apk`;

process.stdout.write(
  `version ${version}\nversionCode ${decision.code} — ${decision.reason}\ntag ${tag}\napk ${apk}\n`,
);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `version=${version}`,
      `code=${decision.code}`,
      `reason=${decision.reason}`,
      `tag=${tag}`,
      `apk=${apk}`,
      '',
    ].join('\n'),
  );
}
