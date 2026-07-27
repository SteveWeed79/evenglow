import {
  type PullResponse,
  pullResponseSchema,
  type PulledMutation,
} from '@steading/contracts';
import { store } from '../db/open';

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

export type PullTransport = (since: number) => Promise<{ status: number; body: unknown }>;

const defaultTransport: PullTransport = async (since) => {
  const res = await fetch(`/api/pull?since=${since}`, {
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
  let since = await (await store()).pulledThrough();

  const outcome: PullOutcome = { applied: 0, skipped: 0, through: since, more: false };

  for (let page = 0; page < MAX_PAGES_PER_PASS; page++) {
    let response: { status: number; body: unknown };
    try {
      response = await transport(since);
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

    // A page that does not advance the watermark would loop forever.
    if (parsed.data.through <= since && parsed.data.mutations.length === 0) break;
    since = parsed.data.through;

    if (!parsed.data.more) break;
  }

  return outcome;
}

/**
 * Applying a page and advancing the watermark is one transaction in the store.
 * Advancing it separately would let a crash between the two skip a page for
 * good — the device would never ask for it again.
 *
 * The store also skips any record with a pending local edit, so a queued change
 * cannot visibly revert while it waits to flush.
 */
async function applyPage(page: PullResponse): Promise<{ applied: number; skipped: number }> {
  return (await store()).applyPulled(inServerOrder(page.mutations), page.through);
}

/** Exported for the diagnostics sheet and for tests. */
export async function pulledThrough(): Promise<number> {
  return (await store()).pulledThrough();
}

/** Sorting is the server's job, but a defensive re-sort costs nothing. */
export function inServerOrder(mutations: readonly PulledMutation[]): PulledMutation[] {
  return [...mutations].sort((a, b) => a.serverTs - b.serverTs);
}
