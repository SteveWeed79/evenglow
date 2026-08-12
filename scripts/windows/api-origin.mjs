import { readFileSync, writeFileSync } from 'node:fs';
import { farmOrigin, isRemote } from '../lib/api-origin.mjs';

/**
 * Reads and sets the server address a development build is compiled against.
 *
 *   node api-origin.mjs is-remote   exit 0 when .env points somewhere else
 *   node api-origin.mjs use-farm    point it at the deployed server
 *   node api-origin.mjs use-local   hand it back to the run scripts
 *   node api-origin.mjs show        print the current value
 *
 * **Node does the file editing rather than PowerShell.** The existing routines
 * rewrite `.env` with a `-replace` one-liner, which is fine for an address they
 * generate themselves. This one has to read `eas.json`, decide, and write —
 * three things that were a `for /f` around a `node -e` last time and never ran
 * once, because the snippet was parsed twice and the quoting did not survive.
 * See `_shared.bat` :ensure_packages for that story. A file and an exit code
 * have nothing to quote.
 */

const ENV_PATH = 'apps/mobile/.env';
const EAS_PATH = 'apps/mobile/eas.json';
const KEY = 'EXPO_PUBLIC_API_URL';

function currentValue() {
  try {
    const line = readFileSync(ENV_PATH, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${KEY}=`));
    return line === undefined ? '' : line.slice(KEY.length + 1).trim();
  } catch {
    return '';
  }
}

/**
 * Rewrites the one line, keeping every other line and the file's ending.
 *
 * Appends the key when it is missing rather than failing: a `.env` copied from
 * the example and edited by hand is a normal state, and losing somebody's other
 * settings to fix an address would be a poor trade.
 */
function setValue(next) {
  let body;
  try {
    body = readFileSync(ENV_PATH, 'utf8');
  } catch {
    body = '';
  }

  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith(`${KEY}=`));

  if (at === -1) lines.push(`${KEY}=${next}`);
  else lines[at] = `${KEY}=${next}`;

  writeFileSync(ENV_PATH, lines.join(eol), 'utf8');
}

const command = process.argv[2];

if (command === 'is-remote') {
  process.exit(isRemote(currentValue()) ? 0 : 1);
}

if (command === 'show') {
  const value = currentValue();
  console.log(value === '' ? '(not set)' : value);
  process.exit(0);
}

if (command === 'use-farm') {
  let eas;
  try {
    eas = JSON.parse(readFileSync(EAS_PATH, 'utf8'));
  } catch {
    console.error(`Could not read ${EAS_PATH}.`);
    process.exit(1);
  }

  const origin = farmOrigin(eas);
  if (origin === null) {
    console.error(
      `${EAS_PATH} has no deployed address in its preview-farm profile.\n` +
        'Set EXPO_PUBLIC_API_URL there first — that is the one place it lives.',
    );
    process.exit(1);
  }

  setValue(origin);
  console.log(origin);
  process.exit(0);
}

if (command === 'use-local') {
  // Emptied rather than set to a guess. The run scripts each write the address
  // that suits how the device is attached — USB, emulator or wifi — and an
  // address invented here would be overwritten by the next run anyway or, worse,
  // would be wrong in a way that looks configured.
  setValue('');
  process.exit(0);
}

console.error('Usage: api-origin.mjs {is-remote|show|use-farm|use-local}');
process.exit(2);
