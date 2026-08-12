/**
 * Which server a development build is pointed at.
 *
 * The decision only, with no filesystem in it, so it can be tested — the same
 * split as `cxx-stale.mjs` and `metro-stale.mjs`, and for the same reason.
 *
 * ## The gap this closes
 *
 * `eas.json` sends `preview-farm` and `production` at the deployed server, so a
 * cloud build reaches it. Every Windows run script, meanwhile, rewrites
 * `apps/mobile/.env` to a LOCAL address on each run — `localhost:3001` down the
 * USB cable, `10.0.2.2` for the emulator, or this machine's LAN IP over wifi.
 *
 * That is right for the case they were written for and it left no way to point
 * a development build at the real server. So "does it work end to end" could
 * only be answered by a full EAS build — ten minutes, and no Metro reload —
 * when the interesting version of the question is a dev build, hot reloading,
 * talking to the deployed API.
 */

/**
 * Is this address somewhere other than the machine running the scripts?
 *
 * The run scripts overwrite the address every time, which is what keeps the
 * emulator and USB flows working — a phone address left behind by yesterday's
 * run produces an emulator build that cannot reach anything (see
 * `:set_lan_address`). But an address deliberately pointed at the farm server
 * must survive that, or "use the real server" would last exactly one run.
 *
 * So the rule is by *destination* rather than by a flag file: anything that
 * resolves to this machine or to something on this network is scratch and may
 * be rewritten; anything else was a decision and is left alone.
 */
export function isRemote(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;

  let host;
  try {
    host = new URL(value.trim()).hostname;
  } catch {
    return false;
  }

  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  // The emulator's alias for its host machine. Not a real address anywhere.
  if (host === '10.0.2.2') return false;
  if (host.startsWith('127.')) return false;
  if (host === '::1' || host === '[::1]') return false;

  // The same three private ranges `:set_lan_address` prefers, in the same
  // order, because they mean the same thing here: a machine on this network.
  if (host.startsWith('192.168.')) return false;
  if (host.startsWith('10.')) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;

  return true;
}

/**
 * The deployed origin, read from `eas.json` rather than written down twice.
 *
 * `preview-farm` is the profile whose whole purpose is "the app, against the
 * real server", so it is already the answer to this question. Duplicating the
 * hostname into a script would give the repo two places to change it and one
 * of them would be missed.
 */
export function farmOrigin(easJson) {
  const value = easJson?.build?.['preview-farm']?.env?.EXPO_PUBLIC_API_URL;
  if (typeof value !== 'string' || value.trim() === '') return null;
  return isRemote(value) ? value.trim() : null;
}
