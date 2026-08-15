import {
  MAX_BATCH_SIZE,
  type Mutation,
  type MutationResult,
  type SyncRefusal,
  type SyncResponse,
} from '@steading/contracts';
import { apiUrl, renewSession, type SessionRenewal, syncHeaders } from '../api';
import { localStore } from '../db/store';
import type { QueuedMutation } from '../db/records';

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
  const res = await fetch(apiUrl('sync'), {
    method: 'POST',
    headers: syncHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ mutations }),
  });

  const body: unknown = await res.json().catch(() => null);
  return { status: res.status, body };
};

/** A session the server no longer accepts, as opposed to work it refuses. */
function isLapsed(status: number): boolean {
  return status === 401 || status === 403;
}

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
  const all = await localStore().readOutboxBySeq();
  const batch = all.filter((m) => m.status === 'queued').slice(0, MAX_BATCH_SIZE);

  const outcome: FlushOutcome = { attempted: batch.length, applied: 0, duplicate: 0, rejected: 0 };
  if (batch.length === 0) return outcome;

  let response: { status: number; body: unknown };
  let renewal: SessionRenewal = 'renewed';
  try {
    response = await transport(batch.map(toEnvelope));

    /**
     * One renewal, one retry, and only for a lapsed session.
     *
     * Access tokens last fifteen minutes and nothing in this loop could mint a
     * new one, so an app left open and online stopped syncing at the quarter
     * hour and stayed stopped until a lifecycle event happened to occur —
     * behind a chip that said work was waiting and an error that told a
     * signed-in farmer to sign in.
     *
     * Once, not in a loop: a second 401 after a successful renewal is a
     * refusal about this request rather than about the session, and retrying
     * that would spin.
     */
    if (isLapsed(response.status)) {
      renewal = await renewSession();
      if (renewal === 'renewed') response = await transport(batch.map(toEnvelope));
    }
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

  /**
   * 401 means the session lapsed. The work is fine; it needs a sign-in, not a
   * rejection, so it stays queued without burning an attempt.
   *
   * **It says nothing is lost first, and that is not padding.** The sentence
   * used to be "Sign in again to send your queued work", which is accurate and
   * was read as a threat — the first real report from a farm was somebody
   * looking at six waiting items asking *"won't those updates be lost?"*
   * (issue #125). They were never at risk: the queue is rows in SQLite,
   * nothing deletes a mutation on failure (invariant 7), and the batch above
   * did not even burn an attempt.
   *
   * A farmer who believes their morning is about to be lost stops using the
   * app, and no amount of it being untrue afterwards gets that back.
   */
  if (isLapsed(response.status)) {
    /**
     * Reached only when a renewal was tried and did not produce a token, so the
     * two answers are genuinely different actions. Telling somebody to sign in
     * when they already are, and the server simply could not be reached, is the
     * same class of defect as the sentence this one replaced.
     */
    await setLastError(
      renewal === 'signed-out'
        ? 'Nothing is lost — sign in again to send the work waiting here.'
        : 'Nothing is lost — this session needs renewing and the farm server could not be reached.',
    );
    return { ...outcome, deferred: 'unauthenticated' };
  }

  /**
   * 402 — the farm is on the free tier, or its subscription ended (D13).
   *
   * **Not a rejection, and the distinction is the most important one in this
   * function.** A rejected mutation goes to the inbox as something a person
   * must look at; there is nothing here for anybody to look at, and routing a
   * farm's entire history there over a payment state would be the app turning
   * on its own user.
   *
   * So it takes the 401 shape exactly: no `recordAttempt`, because attempts
   * are what ripen into `rejectExhausted`, and a farm running free for a year
   * would otherwise cross the ceiling and have its records swept into the
   * inbox six flushes in. Nothing is dropped, nothing is counted, everything
   * stays queued — and the day the farm subscribes, it all goes up.
   *
   * The message comes from the server rather than being written here, because
   * the server knows which of the two states it is and the two say different
   * things. See `syncRefusalMessage`.
   */
  if (response.status === 402) {
    await setLastError(heldMessage(response.body));
    await localStore().setSyncHeld(refusalIn(response.body));
    return { ...outcome, deferred: 'unsubscribed' };
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

  // The store owns what happens to each row — cleared, kept as rejected, or
  // left queued with its attempt counted. This function only tallies what the
  // server said, so the outcome the UI reads and the rows on disk cannot
  // describe different things.
  await localStore().resolveBatch(batch, results);
  await localStore().markSynced(Date.now());

  /**
   * A batch got through, so whatever was holding this farm is over.
   *
   * Cleared here rather than on subscribing, because this is the only place
   * that *knows* — the app is never told a payment succeeded, it finds out by
   * being allowed to write again. A farm that resubscribes and then goes into
   * a barn stays "on this phone" until the first flush lands, which is
   * correct: nothing has reached the server yet.
   */
  await localStore().setSyncHeld(null);

  /**
   * Answered, but without mentioning these.
   *
   * resolveBatch keeps them queued and counts the attempt, because resending
   * is safe and silence must never be read as success. But counting an
   * attempt only bounds the retry if something eventually acts on the count —
   * and nothing did, so a server that consistently omits a mutation had it
   * resent forever. The malformed-batch path above already routes to the
   * inbox on exhaustion; this is the same reasoning for a well-formed
   * response with a hole in it.
   */
  const unanswered = batch.filter((queued) => !byId.has(queued.id));
  if (unanswered.length > 0) {
    await rejectExhausted(
      unanswered,
      'The server kept answering without saying what happened to this record.',
    );
  }

  const next = { ...outcome };
  for (const queued of batch) {
    const result = byId.get(queued.id);
    if (!result) continue;
    if (result.status === 'applied') next.applied += 1;
    else if (result.status === 'duplicate') next.duplicate += 1;
    else next.rejected += 1;
  }

  return next;
}

/**
 * The server's own sentence about why it is holding, parsed not trusted.
 *
 * An API response is external data (invariant 11), and this one reaches a
 * screen — so a malformed body falls back to a sentence that is true in both
 * states rather than rendering whatever arrived.
 */
/**
 * Which of the two states the server is in, if it said.
 *
 * Falls back to `unsubscribed`, the gentler of the two: telling a farm its
 * subscription ended when it never had one is a small confusion, and telling a
 * lapsed farm it never subscribed is the same. Neither is worth a branch that
 * could be wrong in a third way.
 */
function refusalIn(body: unknown): SyncRefusal {
  const said = (body as { refusal?: unknown } | null)?.refusal;
  return said === 'lapsed' ? 'lapsed' : 'unsubscribed';
}

function heldMessage(body: unknown): string {
  const said = (body as { error?: unknown } | null)?.error;
  return typeof said === 'string' && said.length > 0 && said.length <= 200
    ? said
    : 'Kept on this phone. Nothing has been lost.';
}

async function recordAttempt(batch: QueuedMutation[], error: string): Promise<void> {
  await localStore().recordAttempt(batch, error);
}

/** Routes mutations past the attempt ceiling to the inbox so the queue can drain. */
async function rejectExhausted(batch: QueuedMutation[], reason: string): Promise<void> {
  await localStore().rejectExhausted(batch, MAX_ATTEMPTS, reason);
}

async function setLastError(message: string): Promise<void> {
  await localStore().setLastError(message);
}
