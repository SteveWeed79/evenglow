import type { LocalStore } from './db/port';

/**
 * Everything the engine is told about the world, in one object.
 *
 * ## Why one object and not seven variables
 *
 * The store, the farm it holds, the access token, the farm *that* names, the
 * session refresher, the API base, the client version and whether the device
 * is online were each a `let` at the top of whichever module happened to need
 * them first — four files, seven pieces of state, every one settable from
 * anywhere. Each was harmless on its own. Together they are the reason a sync
 * pass could start on one farm and finish on another: a pass read "the store"
 * and "the token" as two separate globals, at two separate moments, and
 * nothing tied the two reads to each other.
 *
 * `sync/pass.ts` now takes its snapshot from here, once, at the start of a
 * pass. The setters the app and the tests already call are unchanged — they
 * write into this object rather than into a private variable — so nothing
 * outside `packages/core` had to move for the engine to stop reading its
 * world piecemeal.
 *
 * Deliberately not exported from the package index: the setters in `api.ts`,
 * `db/store.ts` and `sync/engine.ts` remain the only doors, each with the
 * validation it always had.
 */

export type SessionRenewal = 'renewed' | 'signed-out' | 'unavailable';
export type SessionRefresher = () => Promise<SessionRenewal>;

export interface EngineContext {
  /** The one farm's database this device holds open, or none yet. */
  store: LocalStore | null;
  /** Which farm the store holds, when the installer said. Null is unknown, not any. */
  storeOrgId: string | null;
  /** Moves forward on every install, so a pass can tell its store was replaced. */
  storeGeneration: number;
  accessToken: string | null;
  /** Which farm the token was issued for, when the caller said. */
  accessTokenOrgId: string | null;
  refresher: SessionRefresher | null;
  apiBase: string | null;
  clientVersion: string | null;
  online: boolean;
}

const context: EngineContext = {
  store: null,
  storeOrgId: null,
  storeGeneration: 0,
  accessToken: null,
  accessTokenOrgId: null,
  refresher: null,
  apiBase: null,
  clientVersion: null,
  online: true,
};

/** Read-only to callers; the setters below and in the owning modules write. */
export function engineContext(): Readonly<EngineContext> {
  return context;
}

export function updateContext(patch: Partial<EngineContext>): void {
  Object.assign(context, patch);
}
