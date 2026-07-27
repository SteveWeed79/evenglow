import {
  type PullResponse,
  pullResponseSchema,
  type PulledMutation,
} from '@steading/contracts';
import { apiUrl } from '../api';
import { localStore } from '../db/store';

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
}

export type PullTransport = (
  since: number,
  sinceId: string | null,
) => Promise<{ status: number; body: unknown }>;

const defaultTransport: PullTransport = async (since, sinceId) => {
  const query = sinceId === null ? `since=${since}` : `since=${since}&sinceId=${sinceId}`;
  const res = await fetch(apiUrl('snapshot', query), {
    headers: { 'x-steading-sync': '1' },
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
  const watermark = await localStore().pulledThrough();
  let since = watermark.through;
  let sinceId = watermark.throughId;

  const outcome: PullOutcome = { applied: 0, skipped: 0, through: since, more: false };

  for (let page = 0; page < MAX_PAGES_PER_PASS; page++) {
    let response: { status: number; body: unknown };
    try {
      response = await transport(since, sinceId);
    } catch {
      return { ...outcome, deferred: 'offline' };
    }

    if (response.status === 401 || response.status === 403) {
      return { ...outcome, deferred: 'unauthenticated' };
    }
    if (response.status !== 200) {
      return { ...outcome, deferred: `server-${response.status}` };
    }

    const parsed = pullResponseSchema.safeParse(response.body);
    if (!parsed.success) return { ...outcome, deferred: 'unreadable' };

    const result = await applyPage(parsed.data);
    outcome.applied += result.applied;
    outcome.skipped += result.skipped;
    outcome.through = parsed.data.through;
    outcome.more = parsed.data.more;

    // A page that does not advance the cursor would loop forever. The cursor
    // is the pair, so both halves have to stand still for that to be true —
    // a page of same-millisecond rows advances the ULID while `through` holds.
    if (parsed.data.through === since && parsed.data.throughId === sinceId) break;
    since = parsed.data.through;
    sinceId = parsed.data.throughId;

    if (!parsed.data.more) break;
  }

  return outcome;
}

async function applyPage(page: PullResponse): Promise<{ applied: number; skipped: number }> {
  // Skipping a record with a pending local edit, and advancing BOTH halves of
  // the watermark in the same transaction as the records they cover, are the
  // store's guarantees now — stated in port.ts and asserted against every
  // implementation.
  return localStore().applyPulled(inServerOrder(page.mutations), {
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
