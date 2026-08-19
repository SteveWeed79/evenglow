import {
  type PullResponse,
  pullResponseSchema,
  type PulledMutation,
  readableRows,
} from '@homefarm/contracts';
import { apiUrl, renewSession, syncHeaders } from '../api';
import type { PullResult } from '../db/port';
import { localStore, storeGeneration } from '../db/store';

/**
 * Hydration — the read half of sync.
 *
 * Without this the app is single-device: a reinstall, or a second phone, opens
 * to an empty farm even though the server holds everything. Pull replays the
 * org's mutation log into the same local projection that enqueue writes.
 */

/** Stop after this many pages in one pass, so a long history cannot block the loop. */
const MAX_PAGES_PER_PASS = 20;

export interface PullOutcome {
  applied: number;
  skipped: number;
  through: number;
  more: boolean;
  deferred?: string;
  /** Records swept by the one-time projection repair, when it completed here. */
  repaired?: number;
  /**
   * Rows this build could not model, because the server is newer than the app.
   *
   * Counted rather than merely skipped: a device quietly missing a whole kind
   * of record is the shape of failure this path already had once.
   */
  unmodelable: number;
}

export type PullTransport = (
  since: number,
  sinceId: string | null,
) => Promise<{ status: number; body: unknown }>;

const defaultTransport: PullTransport = async (since, sinceId) => {
  const query = sinceId === null ? `since=${since}` : `since=${since}&sinceId=${sinceId}`;
  const res = await fetch(apiUrl('snapshot', query), {
    headers: syncHeaders(),
  });
  const body: unknown = await res.json().catch(() => null);
  return { status: res.status, body };
};

let inFlight: Promise<PullOutcome> | null = null;

/** Single-flight, for the same reason flush is: two passes would race the watermark. */
export function pullOnce(transport: PullTransport = defaultTransport): Promise<PullOutcome> {
  inFlight ??= runPull(transport).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runPull(transport: PullTransport): Promise<PullOutcome> {
  /**
   * The one-time repair, before the watermark is read rather than after.
   *
   * Winding back to zero is what replays the accepted log over the refused
   * commands a device applied before the server withheld them. It happens here
   * because this is the only loop that can also tell when the replay has
   * finished — and the sweep at the end is safe only then.
   */
  // The farm this pass belongs to. Applying a page into a store that has since
  // been swapped would write one farm's records into another's database, which
  // is the worst version of this hazard and the one no server check can catch.
  const tenant = storeGeneration();
  const repairing = !(await localStore().projectionRepairDone());
  if (repairing) await localStore().startProjectionRepair();

  const watermark = await localStore().pulledThrough();
  let since = watermark.through;
  let sinceId = watermark.throughId;

  const outcome: PullOutcome = {
    applied: 0,
    skipped: 0,
    through: since,
    more: false,
    unmodelable: 0,
  };

  for (let page = 0; page < MAX_PAGES_PER_PASS; page++) {
    let response: { status: number; body: unknown };
    try {
      response = await transport(since, sinceId);
    } catch {
      return { ...outcome, deferred: 'offline' };
    }

    /**
     * One renewal, one retry, for the same reason the flush does it: a token
     * lasts fifteen minutes and nothing else in this loop can mint another, so
     * a device left open simply stopped hydrating at the quarter hour.
     *
     * Once, not in a loop — a second 401 after a successful renewal is about
     * this request rather than the session.
     */
    if (response.status === 401 || response.status === 403) {
      if ((await renewSession()) !== 'renewed') {
        return { ...outcome, deferred: 'unauthenticated' };
      }

      try {
        response = await transport(since, sinceId);
      } catch {
        return { ...outcome, deferred: 'offline' };
      }

      if (response.status !== 200) {
        return { ...outcome, deferred: `server-${response.status}` };
      }
    }
    if (response.status !== 200) {
      return { ...outcome, deferred: `server-${response.status}` };
    }

    const parsed = pullResponseSchema.safeParse(response.body);
    if (!parsed.success) return { ...outcome, deferred: 'unreadable' };

    /**
     * Rows this build cannot model are dropped here, not at the page.
     *
     * The server ships a new entity to every device the moment it knows one,
     * including the ones running last month's APK — so parsing the page as a
     * unit against a strict enum meant one unmodelable row failed all of it and
     * the watermark never moved. That install stopped receiving ANY of the
     * farm's records, permanently, while reporting itself up to date.
     *
     * The cursor still comes from the server's `through`/`throughId`, which are
     * taken from the last row READ rather than the last row kept — so skipping
     * locally advances past what was skipped, exactly as the server's own
     * unknown-entity skip does.
     */
    if (storeGeneration() !== tenant) return { ...outcome, deferred: 'farm-switched' };

    const { known, unmodelable } = readableRows(parsed.data.mutations);
    outcome.unmodelable += unmodelable;
    // Recorded as well as returned. The pass that discovers a record type this
    // build cannot read is not the moment anybody is looking at a screen, and
    // a count that lives only in this function's return value is a count the
    // diagnostics sheet cannot show.
    await localStore().noteUnmodelable(unmodelable);

    const result = await applyPage(known, parsed.data);
    outcome.applied += result.applied;
    outcome.skipped += result.skipped;
    outcome.more = parsed.data.more;

    /**
     * The store stopped at a record this device still owes, and did not move
     * the watermark past it. Paging on would ask for rows beyond a point we
     * have not accepted yet and then discard them — which is the bug this
     * whole path exists to fix, one page further along.
     *
     * Not a `deferred`: nothing failed, and the engine counts a deferral
     * towards its backoff. The next flush drains the queue and the pull after
     * it continues from exactly here.
     */
    if (result.paused) {
      outcome.through = (await localStore().pulledThrough()).through;
      return outcome;
    }

    outcome.through = parsed.data.through;

    // A page that does not advance the cursor would loop forever. The cursor
    // is the pair, so both halves have to stand still for that to be true —
    // a page of same-millisecond rows advances the ULID while `through` holds.
    if (parsed.data.through === since && parsed.data.throughId === sinceId) break;
    since = parsed.data.through;
    sinceId = parsed.data.throughId;

    if (!parsed.data.more) break;
  }

  /**
   * Caught up, so the replay has seen every accepted mutation this farm has.
   *
   * `more` false is the whole condition, and it has to be: a row that simply
   * has not arrived yet is indistinguishable from an orphan, so sweeping before
   * the feed runs out would delete records the server was about to send.
   *
   * The other two ways a pass can end are already excluded by getting here at
   * all. Every deferral returns from inside the loop, and so does the pause at
   * a record this device still owes — which would otherwise leave the tail of
   * the log unread. A pass that hits `MAX_PAGES_PER_PASS` ends with `more`
   * true, so the repair stays open and the device finishes it on a later pass,
   * from where it got to.
   */
  if (repairing && !outcome.more) {
    outcome.repaired = await localStore().finishProjectionRepair();
  }

  return outcome;
}

async function applyPage(
  mutations: readonly PulledMutation[],
  page: PullResponse,
): Promise<PullResult> {
  // Pausing at a record with a pending local edit, and advancing BOTH halves of
  // the watermark in the same transaction as the records they cover, are the
  // store's guarantees now — stated in port.ts and asserted against every
  // implementation.
  return localStore().applyPulled(inServerOrder(mutations), {
    through: page.through,
    throughId: page.throughId,
  });
}

/** Exported for the diagnostics sheet and for tests. */
export async function pulledThrough(): Promise<number> {
  return (await localStore().pulledThrough()).through;
}

/**
 * Sorting is the server's job, but a defensive re-sort costs nothing — and
 * until recently this was not called at all, so the defence the comment
 * claimed did not exist.
 *
 * Ties break on `_id` to match the server's `(serverTs, _id)` cursor exactly.
 * Sorting on the timestamp alone would leave same-millisecond rows in whatever
 * order they arrived, which is the one case where getting it wrong is
 * invisible: two updates to one record inside a millisecond, applied
 * backwards, leave the older value in place with nothing to show for it.
 */
export function inServerOrder(mutations: readonly PulledMutation[]): PulledMutation[] {
  return [...mutations].sort((a, b) =>
    a.serverTs === b.serverTs ? a.id.localeCompare(b.id) : a.serverTs - b.serverTs,
  );
}
