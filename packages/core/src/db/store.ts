import { engineContext, updateContext } from '../context';
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
 *
 * ## What a sync pass does instead
 *
 * **A device holds one farm's database at a time and swaps files to change
 * farms, so "the store" is not a stable thing to have read a moment ago.** The
 * sync loop reads the outbox, awaits a round trip, and writes the answers back
 * — and a farm switch landing inside that gap used to mean one farm's results
 * written into another's outbox, or one farm's hold stamped onto another's
 * meta. Neither is caught by `scoped()`: the server is doing exactly what the
 * token says, and the mistake is on the device.
 *
 * The engine no longer calls this after an await. A pass captures the handle
 * once through `sync/pass.ts` and writes to that handle for its whole length,
 * so its answers can only reach the farm that asked; the generation below is
 * what lets it *say* the store moved, not what keeps it safe. The screens and
 * the reads still come here, because they want whichever farm is open now.
 */

export function setLocalStore(store: LocalStore, orgId: string | null = null): void {
  updateContext({
    store,
    storeOrgId: orgId,
    storeGeneration: engineContext().storeGeneration + 1,
  });
}

/** Captured at the start of a pass, compared later. See `sync/pass.ts`. */
export function storeGeneration(): number {
  return engineContext().storeGeneration;
}

/**
 * The farm whose database is installed, if the installer was told.
 *
 * The generation answers "did the store move?". It cannot answer "is this the
 * farm the token belongs to?", and those are different questions the moment
 * the two halves of a sign-in stop moving together — which they do, by
 * design: the token is set several awaits before the database is opened. See
 * `accessTokenOrg` in `../api` for the failure that pairing catches.
 */
export function storeOrgId(): string | null {
  return engineContext().storeOrgId;
}

export function localStore(): LocalStore {
  const { store } = engineContext();
  if (store === null) {
    throw new Error(
      'No local store installed. Call setLocalStore() during startup — see apps/mobile/src/db/store.ts.',
    );
  }
  return store;
}

/** Tests only: drops the handle so the next call must install one again. */
export function resetLocalStore(): void {
  updateContext({
    store: null,
    storeOrgId: null,
    storeGeneration: engineContext().storeGeneration + 1,
  });
}
