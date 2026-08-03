import { monotonicFactory, ulid } from 'ulid';
import { ULID_PATTERN } from './mutation';

/**
 * All syncable entity IDs are minted here, on the client, before the server
 * ever sees them (D1). Offline records must be able to reference each other
 * immediately, and a replayed batch must be a no-op rather than a duplicate.
 *
 * ## Why the randomness is handed in rather than found
 *
 * `ulid` detects its own source: it looks for `crypto.getRandomValues` on the
 * global and **throws** when there is none. React Native defines `window` as
 * an alias for the global and puts no `crypto` on it, and neither
 * `react-native` nor `expo` polyfills one — verified against the installed
 * packages, and reproduced by running the browser build with the global
 * reshaped:
 *
 *     ulid() THREW -> Failed to find a reliable PRNG (PRNG_DETECT)
 *
 * A detected dependency that only fails on a handset is exactly the shape of
 * bug this project has paid for repeatedly. So the platform says what its
 * source is, once, at boot — the same arrangement as `setApiBase`,
 * `setEngineReporter` and `setOnline`.
 *
 * ## It falls back rather than throwing, and that is deliberate
 *
 * When nothing has been configured this uses `ulid`'s own detection, which is
 * what every caller had before. On Node — the server, the tests — that finds
 * `crypto` and is correct. It is not a degraded PRNG: it either works or
 * raises the same loud error it always did.
 *
 * **What must never happen is a weak fallback.** The ULID is the idempotency
 * key (invariant 3) and the server dedupes on it with `$setOnInsert`. A
 * collision means a genuinely new mutation is answered `duplicate` and the
 * record is silently lost — no rejection, no inbox row, nothing visible.
 * `Math.random` is not an acceptable source here at any convenience.
 */

let configured: (() => string) | null = null;

/**
 * Installs the platform's random source. Called once, before the first screen.
 *
 * `prng` returns a float in [0, 1), which is what the factory wants.
 *
 * **Monotonic**, which is the only factory `ulid` 3 exports and also the one
 * worth having: two IDs minted in the same millisecond still sort in the order
 * they were made. Records created in one burst — a group and its first
 * reading — then read back in the order they happened rather than in whatever
 * order the random bits fell.
 */
export function configureIds(prng: () => number): void {
  configured = monotonicFactory(prng);
}

/** Tests only, so one suite's source cannot leak into the next. */
export function resetIds(): void {
  configured = null;
}

export function newId(): string {
  return configured === null ? ulid() : configured();
}

export function isUlid(value: string): boolean {
  return value.length === 26 && ULID_PATTERN.test(value);
}
