import {
  isMutationStatus,
  MAX_BATCH_SIZE,
  type Mutation,
  type MutationResult,
  type SyncRefusal,
  syncResponseSchema,
} from '@homefarm/contracts'
import { apiUrl, renewSession, type SessionRenewal } from '../api';
import type { QueuedMutation } from '../db/records';
import { beginPass, type Headers, type Pass } from './pass';

/**
 * The flush loop.
 *
 * Single-flight and strictly sequential (A4): one batch in the air at a time,
 * ordered by clientSeq, never Promise.all. Parallel flushing would apply a
 * device's mutations out of order at the server, which is the one thing
 * clientSeq exists to prevent.
 */

/**
 * After this many answers that left it undecided, a mutation is treated as
 * poison and routed to the inbox rather than retried forever. A batch the
 * server will never accept must not be able to wedge the queue behind it (A6:
 * surfaced, not silently dropped, and not silently stuck either).
 *
 * **Answers, not attempts, and that distinction is the whole of H8.** The
 * ceiling used to ripen on `attempts`, which counts every delivery that did
 * not land — including a week with no signal. So the budget was normally
 * already spent by the time anything went wrong, and the *first* response the
 * client could not read swept up to a hundred good mutations into the inbox. A
 * captive portal answering a JSON POST with an HTML login page was enough to
 * do it, and the 402 branch below already named the hazard for its own case.
 *
 * The name stays because every reader of it means the same thing it always
 * meant; what changed is which number it is counting.
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

/**
 * `headers` are the pass's — they carry the token for the farm whose batch
 * this is, and the pass refuses to hand any over while the token names
 * another farm. A fake transport in a test is free to ignore them.
 */
export type SyncTransport = (
  mutations: Mutation[],
  headers: Headers,
) => Promise<{
  status: number;
  body: unknown;
}>;

const defaultTransport: SyncTransport = async (mutations, headers) => {
  const res = await fetch(apiUrl('sync'), {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
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

/**
 * The server's answer, parsed rather than trusted (invariant 11).
 *
 * Null when the body is not an answer at all — a captive portal's page, a
 * proxy's error — which the caller treats as it always has. A row whose
 * status this build does not know becomes a rejection the person can see and
 * send again, rather than a row the store applies or keeps according to
 * whichever branch the unknown word happened to miss.
 */
function readResults(body: unknown): MutationResult[] | null {
  const parsed = syncResponseSchema.safeParse(body);
  if (!parsed.success) return null;

  return parsed.data.results.map((result) =>
    isMutationStatus(result.status)
      ? {
          id: result.id,
          status: result.status,
          ...(result.reason === undefined ? {} : { reason: result.reason }),
        }
      : {
          id: result.id,
          status: 'rejected',
          reason: `The server answered "${result.status}", which this version of the app does not understand.`,
        },
  );
}

async function runFlush(transport: SyncTransport): Promise<FlushOutcome> {
  /**
   * Which farm this pass belongs to, fixed before the first await.
   *
   * A device holds one farm's database at a time, and every step below spans
   * a round trip. A farm switch landing inside that gap used to send THIS
   * farm's queued work under the NEXT farm's token, or write the answers back
   * into the wrong outbox — neither of which `scoped()` can see, because the
   * server is doing exactly what the token it was given says.
   *
   * `pass.store` is the only store this function writes, so the second of
   * those cannot happen whatever lands mid-pass; `pass.send()` is the only
   * source of headers, and it refuses while the token names another farm, so
   * neither can the first. `pass.ts` says why that is a different thing from
   * the fence it replaced.
   */
  const pass = beginPass();
  const all = await pass.store.readOutboxBySeq();
  const batch = all.filter((m) => m.status === 'queued').slice(0, MAX_BATCH_SIZE);

  const outcome: FlushOutcome = { attempted: batch.length, applied: 0, duplicate: 0, rejected: 0 };
  if (batch.length === 0) return outcome;

  // Nothing is sent under a token that belongs to a different farm. Not a
  // deferral to back off from: the switch has already started the next farm's
  // sync, and this pass simply has nothing left to do.
  const send = pass.send();
  if (!send.ok) return { ...outcome, deferred: send.because };

  let response: { status: number; body: unknown };
  let renewal: SessionRenewal = 'renewed';
  try {
    response = await transport(batch.map(toEnvelope), send.headers);

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
     *
     * The retry asks the pass for headers again rather than reusing the
     * first set. A renewal reads the token as it is *now*, and a sign-in to
     * another farm may have replaced it while this waited — in which case the
     * pass refuses and the batch stays where it is, for the farm it belongs
     * to.
     */
    if (isLapsed(response.status)) {
      renewal = await renewSession();
      if (renewal === 'renewed') {
        const again = pass.send();
        if (!again.ok) return { ...outcome, deferred: again.because };
        response = await transport(batch.map(toEnvelope), again.headers);
      }
    }
  } catch (error) {
    if (pass.moved()) return { ...outcome, deferred: 'farm-switched' };

    // Network failure: keep everything queued and count the attempt (A1).
    await recordAttempt(pass, batch, error instanceof Error ? error.message : 'Network error');
    return { ...outcome, deferred: 'offline' };
  }

  /**
   * A store replaced under this pass is reported, and its writes skipped.
   *
   * Reporting rather than protection: every branch below writes to
   * `pass.store`, the farm that asked, so a switch can no longer redirect a
   * hold or an error onto the farm that replaced it — the defect the 402
   * branch used to have, when it reached for the installed store as it stood
   * when the round trip ended. What a replaced store *is* is one whose handle
   * the opener has closed, and writing to it would only throw where this says
   * why. The batch stays queued and goes up again on that farm's next pass,
   * as a duplicate the server already knows how to answer.
   */
  const after = pass.moved();
  if (after) return { ...outcome, deferred: after };

  // 5xx is the server's problem — retry later, keep the work.
  if (response.status >= 500) {
    await recordAttempt(pass, batch, `Server error ${response.status}`);
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
     * Three situations, three sentences, and each has to be the true one.
     * Telling somebody to sign in when they already are, or that the server
     * could not be reached when it answered twice, is the same class of
     * defect as the sentence this replaced.
     *
     * `signed-out`: the renewal found no session, so signing in is the action.
     * `renewed`: a token was minted and the server refused the batch under it
     * as well — a refusal of the session, not an outage, and it used to be
     * reported as the server being unreachable, which it demonstrably was
     * not. `unavailable`: the renewal itself could not be tried, and nothing
     * here can say more than that.
     */
    await setLastError(
      pass,
      renewal === 'signed-out'
        ? 'Nothing is lost — sign in again to send the work waiting here.'
        : renewal === 'renewed'
          ? 'Nothing is lost — the farm server would not accept this session. Sign in again to send the work waiting here.'
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
    await setLastError(pass, heldMessage(response.body));
    await pass.store.setSyncHeld(refusalIn(response.body));
    return { ...outcome, deferred: 'unsubscribed' };
  }

  /**
   * This build is older than the server will take a batch from ([23], [24]).
   *
   * The same shape as the 402 above and for the same reason: **nothing is
   * wrong with these mutations.** They are valid, the client is old, and
   * routing a farm's history to the rejected inbox over the version of an APK
   * would be the app punishing somebody for not having been told to update.
   * No `recordAttempt` either — attempts ripen into `rejectExhausted`, and a
   * farm that does not notice the sentence for a fortnight must not have its
   * queue swept as a consequence.
   *
   * The day the app is updated, the batch goes up untouched.
   */
  if (response.status === 426) {
    await setLastError(pass, heldMessage(response.body));
    await pass.store.setSyncHeld('appTooOld');
    return { ...outcome, deferred: 'app-too-old' };
  }

  const results = readResults(response.body);
  if (results === null) {
    // A 4xx with no per-mutation results (a malformed batch) is not retryable
    // in any useful sense, but it must not loop forever either.
    await recordAttempt(pass, batch, `Unreadable response (${response.status})`);
    /**
     * Counted apart from the attempt above, and it is the count that decides.
     *
     * `attempts` still moves because a delivery still did not land, and the
     * diagnostics sheet should say so. But something answered and left every
     * one of these undecided, and that — not a fortnight of no signal — is
     * what a poison ceiling is entitled to ripen on.
     *
     * Both counts move, as they do for a well-formed answer with a hole in
     * it: `attempts` because a delivery was tried and did not land, this
     * because something answered and decided nothing.
     */
    await recordUndecided(pass, batch);
    await rejectExhausted(pass, batch, `The server could not read that batch (${response.status}).`);
    return { ...outcome, deferred: `unreadable-${response.status}` };
  }

  return applyResults(pass, batch, results, outcome);
}

async function applyResults(
  pass: Pass,
  batch: QueuedMutation[],
  results: MutationResult[],
  outcome: FlushOutcome,
): Promise<FlushOutcome> {
  const byId = new Map(results.map((r) => [r.id, r]));

  // The store owns what happens to each row — cleared, kept as rejected, or
  // left queued with its attempt counted. This function only tallies what the
  // server said, so the outcome the UI reads and the rows on disk cannot
  // describe different things.
  await pass.store.resolveBatch(batch, results);

  /**
   * The two writes that used to need a fence of their own.
   *
   * `resolveBatch` is an await like any other, and before the pass held its
   * store a switch landing inside it sent these to the farm that had just
   * opened: `markSynced` stamped a farm that had flushed nothing as having
   * synced this instant, and `setSyncHeld(null)` cleared a hold that was
   * genuinely true of it — a free-tier farm's `noAccount`, an unpaid farm's
   * `unsubscribed`, an old build's `appTooOld`. Every one of those turned the
   * chip from a sentence that explains the state into "waiting", which is the
   * exact failure D13 exists to prevent, arrived at from the other end.
   *
   * They go to `pass.store` now, the farm whose batch went up, which is the
   * farm that earned them. The `moved()` check is only what keeps a closed
   * handle from throwing here; `tests/offline/farm-switch.test.ts` holds the
   * farm that replaced this one untouched either way.
   */
  if (pass.moved() === null) {
    await pass.store.markSynced(Date.now());

    /**
     * A batch got through, so whatever was holding this farm is over.
     *
     * Cleared here rather than on subscribing, because this is the only place
     * that *knows* — the app is never told a payment succeeded, it finds out
     * by being allowed to write again. A farm that resubscribes and then goes
     * into a barn stays "on this phone" until the first flush lands, which is
     * correct: nothing has reached the server yet.
     */
    await pass.store.setSyncHeld(null);

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
        pass,
        unanswered,
        'The server kept answering without saying what happened to this record.',
      );
    }
  }

  /**
   * Tallied either way, and NOT reported as deferred.
   *
   * `resolveBatch` landed on the farm that sent the batch — the pass holds
   * its store — so this batch really was delivered and really was resolved.
   * `deferred` means the opposite ("could not be delivered at all; entries
   * stay queued") and the engine counts it as a consecutive failure, which
   * would back a farm off for work that went through.
   */
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

// Every helper below writes to the pass's store and nothing else, which is
// the whole of the guarantee: there is no other store to reach from here.

async function recordAttempt(pass: Pass, batch: QueuedMutation[], error: string): Promise<void> {
  await pass.store.recordAttempt(batch, error);
}

/** One more answer that decided nothing about these — the count that ripens. */
async function recordUndecided(pass: Pass, batch: QueuedMutation[]): Promise<void> {
  await pass.store.recordUndecided(batch);
}

/** Routes mutations past the undecided-answer ceiling to the inbox so the queue can drain. */
async function rejectExhausted(pass: Pass, batch: QueuedMutation[], reason: string): Promise<void> {
  await pass.store.rejectExhausted(batch, MAX_ATTEMPTS, reason);
}

async function setLastError(pass: Pass, message: string): Promise<void> {
  await pass.store.setLastError(message);
}
