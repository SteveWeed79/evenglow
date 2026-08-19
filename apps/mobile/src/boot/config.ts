import { setApiBase } from '@homefarm/core/api';

/**
 * Where the server is, and what to do when nobody said.
 *
 * ## Why this is a module rather than three lines in `start()`
 *
 * It used to be three lines in `start()`, and they threw. A build with no
 * `EXPO_PUBLIC_API_URL` refused to boot at all — which, on an **offline-first**
 * app, is the wrong end of the trade twice over:
 *
 * - The device holding a farm's records would not open to show them. The
 *   failure screen even said "nothing you have logged is lost — it is on this
 *   device", which was true and useless, because the app would not let anybody
 *   at it.
 * - The thing that was actually missing is the *network* origin. Everything
 *   this app is for — logging eggs, treatments, losses, hours — happens
 *   against a local SQLite file and needs no server at all.
 *
 * The concern behind the throw was real and is kept: a missing origin must not
 * masquerade as bad signal. A network error and an unconfigured build are
 * indistinguishable from inside the flush loop, so the queue would back off
 * politely forever while the chip said the reassuring thing. The answer is to
 * name the fault and let nothing touch the network, not to withhold the app.
 *
 * So: a fault is recorded, sync never starts, and the chip says **Not set up**
 * in the colour reserved for things no amount of waiting will fix.
 *
 * The one genuine dead end is a device with nobody signed in — see `start()`.
 */

/**
 * `EXPO_PUBLIC_` is inlined at build time by Expo's bundler, as a literal
 * substitution on this exact member expression. It must be written out in
 * full, here, once — `process.env[name]` would not be replaced and would read
 * as undefined on a handset.
 *
 * It ships inside the APK and is trivially extractable, so an origin is the
 * only thing that may go here — never a secret (invariant 12).
 */
const RAW: string | undefined = process.env.EXPO_PUBLIC_API_URL;

export type ApiFault =
  | { kind: 'missing' }
  | { kind: 'malformed'; value: string; detail: string };

export type ApiConfig = { kind: 'configured'; base: string } | ApiFault;

/**
 * Reads one value and says what it is. Pure, and exported for tests — the
 * whole point of splitting it from `configureApi` is that the decision can be
 * checked without a bundler having inlined anything.
 */
export function resolveApiConfig(raw: string | undefined): ApiConfig {
  if (raw === undefined || raw.trim() === '') return { kind: 'missing' };

  const value = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { kind: 'malformed', value, detail: 'that is not a whole web address' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      kind: 'malformed',
      value,
      detail: `it starts with ${parsed.protocol.replace(':', '')}, and it needs http or https`,
    };
  }

  return { kind: 'configured', base: value };
}

let fault: ApiFault | null = null;

/**
 * Applies the build's configuration, once, at boot.
 *
 * Returns the outcome so `start()` can decide what may run; the fault is also
 * held here so the chip and the diagnostics screen can read it without it
 * being threaded through every screen that renders a header.
 */
export function configureApi(raw: string | undefined = RAW): ApiConfig {
  const config = resolveApiConfig(raw);

  if (config.kind === 'configured') {
    fault = null;
    setApiBase(config.base);
  } else {
    fault = config;
  }

  return config;
}

/** Null when the origin is set and usable — which is the normal case. */
export function apiFault(): ApiFault | null {
  return fault;
}

/** Exported for tests, which must not leak a fault into the next one. */
export function resetApiFault(): void {
  fault = null;
}

/**
 * The fault in words a farmer can read back to whoever can help.
 *
 * Deliberately says what still works first. Somebody reading this has an app
 * that will not sync, and the first thing they need to know is that this is
 * not the sentence that means their morning is gone.
 */
export function explainFault(reason: ApiFault): string {
  const cause =
    reason.kind === 'missing'
      ? 'This copy of the app was built without the address of your farm server (EXPO_PUBLIC_API_URL).'
      : `The farm server address this app was built with cannot be used — ${reason.detail}: ${reason.value}`;

  return (
    `${cause} Everything you log is being saved on this device and none of it is at risk, ` +
    'but it cannot reach the server or your other devices until the address is set. ' +
    'See the README, or run the setup script again.'
  );
}
