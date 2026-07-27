import {
  MAX_BATCH_SIZE,
  type Mutation,
  type MutationResult,
  type SyncResponse,
} from '@/lib/contracts/mutation';
import { db, readOutboxBySeq } from '../db/open';
import { META, parseMeta, type QueuedMutation, STORES } from '../db/schema';

/**
 * The flush loop.
 *
 * Single-flight and strictly sequential (A4): one batch in the air at a time,
 * ordered by clientSeq, never Promise.all. Parallel flushing would apply a
 * device's mutations out of order at the server, which is the one thing
 * clientSeq exists to prevent.
 */

/**
 * After this many failed attempts a mutation is treated as poison and routed
 * to the inbox rather than retried forever. A batch the server will never
 * accept must not be able to wedge the queue behind it (A6: surfaced, not
 * silently dropped, and not silently stuck either).
 */
export const MAX_ATTEMPTS = 6;

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

export interface FlushOutcome {
  attempted: number;
  applied: number;
  duplicate: number;
  rejected: number;
  /** Set when the batch could not be delivered at all; entries stay queued. */
  deferred?: string;
}

export function backoffDelay(attempts: number): number {
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);
  // Jitter, so a barn full of devices coming back on one signal do not
  // synchronise into a thundering herd.
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

/** Strips local bookkeeping — the server only ever sees the envelope. */
function toEnvelope(queued: QueuedMutation): Mutation {
  return {
    schemaVersion: queued.schemaVersion,
    id: queued.id,
    targetId: queued.targetId,
    entity: queued.entity,
    op: queued.op,
    payload: queued.payload,
    deviceId: queued.deviceId,
    clientSeq: queued.clientSeq,
    clientTs: queued.clientTs,
  };
}

export type SyncTransport = (mutations: Mutation[]) => Promise<{
  status: number;
  body: unknown;
}>;

const defaultTransport: SyncTransport = async (mutations) => {
  const res = await fetch('/api/sync', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Custom header, so the request cannot be forged by a simple cross-origin
      // form post. Origin verification proper lands in Phase 4.
      'x-steading-sync': '1',
    },
    body: JSON.stringify({ mutations }),
  });

  const body: unknown = await res.json().catch(() => null);
  return { status: res.status, body };
};

let inFlight: Promise<FlushOutcome> | null = null;

/**
 * Flushes one batch. Concurrent callers share the in-flight promise rather
 * than starting a second batch — the single-flight guard is what makes
 * "never parallel" true even when the online event, a timer, and a user
 * action all fire at once.
 */
export function flushOnce(transport: SyncTransport = defaultTransport): Promise<FlushOutcome> {
  inFlight ??= runFlush(transport).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

function isSyncResponse(body: unknown): body is SyncResponse {
  return (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { results?: unknown }).results)
  );
}

async function runFlush(transport: SyncTransport): Promise<FlushOutcome> {
  const all = await readOutboxBySeq();
  const batch = all.filter((m) => m.status === 'queued').slice(0, MAX_BATCH_SIZE);

  const outcome: FlushOutcome = { attempted: batch.length, applied: 0, duplicate: 0, rejected: 0 };
  if (batch.length === 0) return outcome;

  let response: { status: number; body: unknown };
  try {
    response = await transport(batch.map(toEnvelope));
  } catch (error) {
    // Network failure: keep everything queued and count the attempt (A1).
    await recordAttempt(batch, error instanceof Error ? error.message : 'Network error');
    return { ...outcome, deferred: 'offline' };
  }

  // 5xx is the server's problem — retry later, keep the work.
  if (response.status >= 500) {
    await recordAttempt(batch, `Server error ${response.status}`);
    return { ...outcome, deferred: `server-${response.status}` };
  }

  // 401 means the session lapsed. The work is fine; it needs a sign-in, not a
  // rejection, so it stays queued without burning an attempt.
  if (response.status === 401 || response.status === 403) {
    await setLastError('Sign in again to send your queued work.');
    return { ...outcome, deferred: 'unauthenticated' };
  }

  if (!isSyncResponse(response.body)) {
    // A 4xx with no per-mutation results (a malformed batch) is not retryable
    // in any useful sense, but it must not loop forever either.
    await recordAttempt(batch, `Unreadable response (${response.status})`);
    await rejectExhausted(batch, `The server could not read that batch (${response.status}).`);
    return { ...outcome, deferred: `unreadable-${response.status}` };
  }

  return applyResults(batch, response.body.results, outcome);
}

async function applyResults(
  batch: QueuedMutation[],
  results: MutationResult[],
  outcome: FlushOutcome,
): Promise<FlushOutcome> {
  const byId = new Map(results.map((r) => [r.id, r]));
  const database = await db();
  const tx = database.transaction([STORES.outbox, STORES.meta], 'readwrite');
  const outbox = tx.objectStore(STORES.outbox);
  const meta = tx.objectStore(STORES.meta);

  let cleared = parseMeta('clearedCount', await meta.get(META.clearedCount)) ?? 0;
  const next = { ...outcome };

  for (const queued of batch) {
    const result = byId.get(queued.id);

    if (!result) {
      // The server answered without mentioning this mutation. Keep it queued
      // rather than assume either outcome — resending is safe (D1 + $setOnInsert).
      await outbox.put({ ...queued, attempts: queued.attempts + 1 });
      continue;
    }

    if (result.status === 'applied' || result.status === 'duplicate') {
      await outbox.delete(queued.id);
      cleared += 1;
      if (result.status === 'applied') next.applied += 1;
      else next.duplicate += 1;
      continue;
    }

    // rejected | conflict → the inbox. Never deleted (A6).
    await outbox.put({
      ...queued,
      status: 'rejected',
      attempts: queued.attempts + 1,
      rejectedReason: result.reason ?? 'The server would not accept that.',
      rejectedAt: Date.now(),
    });
    next.rejected += 1;
  }

  await meta.put(cleared, META.clearedCount);
  await meta.put(Date.now(), META.lastSyncAt);
  await meta.delete(META.lastError);
  await tx.done;

  return next;
}

async function recordAttempt(batch: QueuedMutation[], error: string): Promise<void> {
  const database = await db();
  const tx = database.transaction([STORES.outbox, STORES.meta], 'readwrite');
  const outbox = tx.objectStore(STORES.outbox);

  for (const queued of batch) {
    await outbox.put({ ...queued, attempts: queued.attempts + 1, lastError: error });
  }

  await tx.objectStore(STORES.meta).put(error, META.lastError);
  await tx.done;
}

/** Routes mutations past the attempt ceiling to the inbox so the queue can drain. */
async function rejectExhausted(batch: QueuedMutation[], reason: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(STORES.outbox, 'readwrite');
  const outbox = tx.objectStore(STORES.outbox);

  for (const queued of batch) {
    const current = await outbox.get(queued.id);
    if (!current || current.status === 'rejected') continue;
    if (current.attempts < MAX_ATTEMPTS) continue;

    await outbox.put({
      ...current,
      status: 'rejected',
      rejectedReason: reason,
      rejectedAt: Date.now(),
    });
  }

  await tx.done;
}

async function setLastError(message: string): Promise<void> {
  await (await db()).put(STORES.meta, message, META.lastError);
}
