import {
  type PullResponse,
  pullResponseSchema,
  type PulledMutation,
} from '@/lib/contracts/mutation';
import { db } from '../db/open';
import { toLocalRecord } from '../db/project';
import { META, parseMeta, STORES } from '../db/schema';

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
  const database = await db();
  let since = parseMeta('pulledThrough', await database.get(STORES.meta, META.pulledThrough)) ?? 0;

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

async function applyPage(page: PullResponse): Promise<{ applied: number; skipped: number }> {
  const database = await db();
  const tx = database.transaction([STORES.outbox, STORES.records, STORES.meta], 'readwrite');
  const records = tx.objectStore(STORES.records);

  /**
   * Anything this device is still holding is newer than what the server can
   * tell us about it, so local optimistic state wins until it flushes.
   * Overwriting here would make a queued edit visibly revert — the single
   * most alarming thing an offline app can do.
   */
  const pending = new Set<string>();
  for (const queued of await tx.objectStore(STORES.outbox).getAll()) {
    pending.add(queued.targetId);
  }

  let applied = 0;
  let skipped = 0;

  for (const mutation of page.mutations) {
    if (pending.has(mutation.targetId)) {
      skipped += 1;
      continue;
    }

    await records.put(
      toLocalRecord(
        mutation.entity,
        mutation.targetId,
        mutation.op,
        mutation.payload,
        mutation.serverTs,
      ),
    );
    applied += 1;
  }

  await tx.objectStore(STORES.meta).put(page.through, META.pulledThrough);
  await tx.done;

  return { applied, skipped };
}

/** Exported for the diagnostics sheet and for tests. */
export async function pulledThrough(): Promise<number> {
  return parseMeta('pulledThrough', await (await db()).get(STORES.meta, META.pulledThrough)) ?? 0;
}

/** Sorting is the server's job, but a defensive re-sort costs nothing. */
export function inServerOrder(mutations: readonly PulledMutation[]): PulledMutation[] {
  return [...mutations].sort((a, b) => a.serverTs - b.serverTs);
}
