import { readFileSync } from 'node:fs';
import { isRemote } from '../lib/api-origin.mjs';
import { describeProbe, readSupportEnv } from '../lib/support-probe.mjs';

/**
 * Can the app file a report, against the server it is actually pointed at?
 *
 *   node support-check.mjs
 *
 * Prints one or two indented lines and exits 0 whatever it finds — an
 * unconfigured support loop is a supported state (the share sheet still works),
 * so this is never a failure, only a fact.
 *
 * **Which machine is the whole point.** See `support-probe.mjs`: the old check
 * read this PC's `.env.local` no matter where the build pointed, so it reported
 * the laptop's configuration for the deployed box and said OK while the handset
 * was being told the server had nowhere to file.
 *
 * The address is read from `apps/mobile/.env`, the same file `api-origin.mjs`
 * writes, because that is what gets compiled into the build.
 */

const ENV_PATH = 'apps/mobile/.env';
const LOCAL_ENV = '.env.local';
const KEY = 'EXPO_PUBLIC_API_URL';

/**
 * The gutter the rest of the check window uses.
 *
 * `  [ MISSING ]` is the widest tag and is 13 characters, so text starts at 14
 * and the whole column lines up whatever the tag. Worth getting exactly right:
 * these lines get pasted into a chat next to lines this script did not write.
 */
const GUTTER = 14;

function say(tag, text) {
  console.log(`  [ ${tag} ]`.padEnd(GUTTER) + text);
}

function note(text) {
  console.log(' '.repeat(GUTTER) + text);
}

function read(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function origin() {
  const line = read(ENV_PATH)
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${KEY}=`));
  return line === undefined ? '' : line.slice(KEY.length + 1).trim();
}

/**
 * An empty body to `POST /support`, which cannot become a ticket.
 *
 * Four seconds because this runs inside a setup check somebody is waiting on,
 * and a box that is down should read as down rather than as a hung window.
 */
async function probe(base) {
  const url = new URL('/support', base);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(4000),
  });
  return response.status;
}

const target = origin();

if (!isRemote(target)) {
  // This PC is the server, so its own `.env.local` is the right file to read
  // and there is nothing to ask over the network.
  const { token, repo } = readSupportEnv(read(LOCAL_ENV));

  if (!token) {
    say('NOTE', 'not set up on this PC. "Something is wrong" still works and');
    note('offers to share the report by hand; it just cannot file it');
    note('for you. Ask Claude to set it up.');
  } else if (repo === null) {
    say('NOTE', 'a token is set but SUPPORT_REPO is not, so nothing knows');
    note('where to file. Add SUPPORT_REPO=owner/repo to .env.local.');
  } else {
    say('OK', `this PC's server files issues to ${repo}`);
  }
  process.exit(0);
}

/**
 * Pointed at a real deployment, so this PC's `.env.local` is irrelevant and
 * the only honest answer comes from the server itself.
 */
let status;
try {
  status = await probe(target);
} catch {
  say('NOTE', `could not reach ${target} to ask.`);
  note('Either it is down or this PC has no route to it. The report');
  note('button still works and can share by hand.');
  process.exit(0);
}

const { state, message } = describeProbe(status);

if (state === 'ready') {
  say('OK', `${target} ${message}`);
} else {
  say('NOTE', message);
  if (state === 'nowhere') {
    note(`Add SUPPORT_GITHUB_TOKEN and SUPPORT_REPO on ${target}`);
    note('— see "Turning on Something is wrong" in docs/OPERATOR.md.');
    note('Reports are still kept on the phone and can be shared by hand.');
  }
}

process.exit(0);
