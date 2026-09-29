import {
  type PullResponse,
  pullResponseSchema,
  type PulledMutation,
  readableRows,
} from '@homefarm/contracts';
import { apiUrl, renewSession } from '../api';
import type { LocalStore, PullResult } from '../db/port';
import { beginPass, type Headers } from './pass';

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

/**
 * `headers` are the pass's, which refuse a token for another farm; a fake
 * transport in a test is free to ignore them.
 */
export type PullTransport = (
  since: number,
  sinceId: string | null,
  headers: Headers,
) => Promise<{ status: number; body: unknown }>;

const defaultTransport: PullTransport = async (since, sinceId, headers) => {
  const query = sinceId === null ? `since=${since}` : `since=${since}&sinceId=${sinceId}`;
  const res = await fetch(apiUrl('snapshot', query), { headers });
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
  // The farm this pass belongs to, and the only store it writes. Applying a
  // page into a store that has since been swapped would write one farm's
  // records into another's database, which is the worst version of this
  // hazard and the one no server check can catch — so the handle is captured
  // here and every write below goes to it. `pass.send()` refuses while the
  // token and the store disagree, which is every moment of a sign-in and is
  // not a swap the generation can see. See `pass.ts`.
  const pass = beginPass();
  const repairing = !(await pass.store.projectionRepairDone());
  if (repairing) await pass.store.startProjectionRepair();

  const watermark = await pass.store.pulledThrough();
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
    /**
     * Asked before the request as well as after it.
     *
     * The check below catches a page that arrived for the wrong farm. This one
     * means the page is never asked for — a device whose token has moved ahead
     * of its database has no business pulling a snapshot it cannot legally
     * write anywhere, and after a switch it also stops the *next* page being
     * fetched under a token the loop has already been told not to trust.
     */
    const send = pass.send();
    if (!send.ok) return { ...outcome, deferred: send.because };

    let response: { status: number; body: unknown };
    try {
      response = await transport(since, sinceId, send.headers);
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

      // Asked again: the renewal read the token as it is now, and a sign-in
      // may have replaced it with another farm's while this waited.
      const again = pass.send();
      if (!again.ok) return { ...outcome, deferred: again.because };

      try {
        response = await transport(since, sinceId, again.headers);
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
    // Reporting, not protection: the page below goes to the captured store
    // either way, and a replaced store is one whose handle the opener has
    // closed — writing would only throw where this says why.
    const elsewhere = pass.moved();
    if (elsewhere) return { ...outcome, deferred: elsewhere };

    const { known, unmodelable } = readableRows(parsed.data.mutations);
    outcome.unmodelable += unmodelable;

    const result = await applyPage(pass.store, known, parsed.data);
    outcome.applied += result.applied;
    outcome.skipped += result.skipped;
    outcome.more = parsed.data.more;

    /**
     * Recorded as well as returned. The pass that discovers a record type this
     * build cannot read is not the moment anybody is looking at a screen, and
     * a count that lives only in this function's return value is a count the
     * diagnostics sheet cannot show.
     *
     * **After the page lands, and only for a page taken whole.** A paused page
     * leaves the watermark short of these rows, so the next pass fetches and
     * counts them again — noted before `applyPage`, a `beehive` row behind one
     * pending local edit was counted once per pass until the edit flushed. A
     * page that throws notes nothing, which is also right: nothing of it was
     * kept.
     */
    if (!result.paused) await pass.store.noteUnmodelable(unmodelable);

    /**
     * ── A pull counts as having synced, and only a flush used to ────────────
     *
     * `markSynced` was called from `flush.ts` alone, after OUTGOING mutations.
     * `lastSyncAt` therefore stayed null on a device that had only ever
     * received — and `backup/exposure.ts` reads exactly that field to decide
     * whether a farm's records exist anywhere but this handset.
     *
     * So a phone that installed, signed in and pulled 1,500 records was told
     * *"on this phone only — nothing has been copied anywhere else"* and
     * advised to set up the account it had just signed into. The one moment
     * A2.3 reserves for asking, spent on the one farm that had already done it.
     *
     * **Only a page that actually delivered rows.** `exposure.ts` argues the
     * test is "nothing has ever reached a server" rather than "has no account",
     * and a pull that returned nothing proves this device can reach the server —
     * not that the server is holding anything of this farm's. Records coming
     * back the other way are proof of the copy, which is the thing being
     * claimed.
     *
     * Inside the loop rather than after it, so a pass that pages for a while
     * and then defers still records the contact it genuinely made.
     */
    if (result.applied > 0) await pass.store.markSynced(Date.now());

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
      outcome.through = (await pass.store.pulledThrough()).through;
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
   * **It is only a safe condition because the server stopped lying about it**
   * (H6). `readSnapshotPage` answered `false` when it had merely *stopped* at
   * a row it could not decide yet, to save the round trip that re-reads up to
   * the same row — and this read that as the log having run out, so a device
   * whose records arrived by pull deleted every record whose log rows sat
   * beyond the stall, and set `repairDone` so it never ran again. A stall says
   * `more: true` now. Nothing here can tell the two apart, so nothing here can
   * defend against that line being optimised back.
   *
   * The other two ways a pass can end are already excluded by getting here at
   * all. Every deferral returns from inside the loop, and so does the pause at
   * a record this device still owes — which would otherwise leave the tail of
   * the log unread. A pass that hits `MAX_PAGES_PER_PASS` ends with `more`
   * true, so the repair stays open and the device finishes it on a later pass,
   * from where it got to.
   */
  if (repairing && !outcome.more) {
    outcome.repaired = await pass.store.finishProjectionRepair();
  }

  return outcome;
}

async function applyPage(
  store: LocalStore,
  mutations: readonly PulledMutation[],
  page: PullResponse,
): Promise<PullResult> {
  // Pausing at a record with a pending local edit, and advancing BOTH halves of
  // the watermark in the same transaction as the records they cover, are the
  // store's guarantees now — stated in port.ts and asserted against every
  // implementation.
  return store.applyPulled(inServerOrder(mutations), {
    through: page.through,
    throughId: page.throughId,
  });
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
// Kept here for the callers that always found it here. It reads the installed
// store, which a pass must not, so it lives with the other such reads.
export { pulledThrough } from './queue';

export function inServerOrder(mutations: readonly PulledMutation[]): PulledMutation[] {
  return [...mutations].sort((a, b) =>
    a.serverTs === b.serverTs ? a.id.localeCompare(b.id) : a.serverTs - b.serverTs,
  );
}
