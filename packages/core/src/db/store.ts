import type { LocalStore } from './port';

/**
 * The engine's handle on storage.
 *
 * A module-level provider rather than a parameter threaded through every call
 * site: components call `useLog()`, not `useLog(store)`, and making the store
 * an argument would push a storage concern into every screen for no benefit.
 *
 * **There is no default, and that is the point.** It used to fall back to
 * IndexedDB if nobody had set one, which is how the migration's worst bug
 * happened: on a handset the reads resolved to a browser database that had
 * never been written to, so adding stock silently did nothing and the screen
 * showed a farm with no animals. A lazy default cannot be wrong loudly — it
 * can only be wrong quietly.
 *
 * So an unset store throws, naming the fix. There is exactly one storage
 * implementation now, and exactly one place that installs it.
 */

let current: LocalStore | null = null;

/**
 * Which farm's store is installed, as a number that only moves forward.
 *
 * **A device holds one farm's database at a time and swaps files to change
 * farms, so "the store" is not a stable thing to have read a moment ago.** The
 * sync loop reads the outbox, awaits a round trip, and writes the answers back
 * — and a farm switch landing inside that gap meant one farm's queued work
 * could be sent under another farm's token, or another farm's results written
 * into this one's outbox. Neither is caught by `scoped()`: the server is doing
 * exactly what the token says, and the mistake is on the device.
 *
 * So every step that spans an await captures this first and refuses to
 * continue if it moved. Cheaper and harder to get wrong than passing a store
 * handle down every call — and it fails closed, because a stale generation can
 * only stop work, never misdirect it.
 */
let generation = 0;

/**
 * Which farm the installed store holds, or null when the caller did not say.
 *
 * The generation above answers "did the store move?". It cannot answer "is
 * this the farm the token belongs to?", and those are different questions the
 * moment the two halves of a sign-in stop moving together — which they do, by
 * design: the token is set several awaits before the database is opened. See
 * `accessTokenOrg` in `../api` for the failure that pairing catches.
 */
let currentOrgId: string | null = null;

export function setLocalStore(store: LocalStore, orgId: string | null = null): void {
  current = store;
  currentOrgId = orgId;
  generation += 1;
}

/** Captured before an await, re-read after it. See the note above. */
export function storeGeneration(): number {
  return generation;
}

/** The farm whose database is installed, if the installer was told. */
export function storeOrgId(): string | null {
  return currentOrgId;
}

export function localStore(): LocalStore {
  if (current === null) {
    throw new Error(
      'No local store installed. Call setLocalStore() during startup — see apps/mobile/src/db/store.ts.',
    );
  }
  return current;
}

/** Tests only: drops the handle so the next call must install one again. */
export function resetLocalStore(): void {
  current = null;
  currentOrgId = null;
  generation += 1;
}
