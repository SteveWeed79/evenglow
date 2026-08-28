import { hostname } from 'node:os';
import { canMutate, isUploadStamp, type Role, roleRefusal } from '@homefarm/contracts';
import type { SessionClaims } from '../auth/claims';
import { findUserById, listOrgIds } from '../db/identity';
import type { Scoped } from '../db/scoped';
import { scopedOn } from '../db/scoped';
import { db } from '../db/client';
import { recordSweep } from '../db/sweep-status';
import { inCommitOrder } from './commit-order';
import { PENDING, type StoredOutcome, UNREADABLE } from './outcome';
import { type MutationDoc, project, replayFromLog, stampOutcome } from './apply';

/**
 * The rows whose client never came back.
 *
 * ## The hole this closes, which the fix for P0-2 opened
 *
 * `pending` is stamped with the envelope, before `project()` decides anything,
 * and the feed withholds it. Both halves are right: a row carrying **no**
 * outcome is ambiguous between "applied and unstamped" and "refused and
 * unstamped", and the two need opposite treatment — let them through and a
 * refusal replicates, filter them out and a genuinely applied row is dropped
 * from the feed for ever, which is P0-2 inverted.
 *
 * `pending` says exactly one thing, and it normally self-heals through
 * machinery that already exists: the client never got a response, so the row
 * stays queued, the resend hits the duplicate branch, sees `pending`, and
 * re-projects from the stored envelope.
 *
 * **Unless the client never comes back.** A phone that is force-stopped between
 * the log write and the projection, wiped, lost, or simply never opened again
 * leaves that row `pending` for ever — and `pending` is withheld from the feed,
 * so **the record reaches no other device on the farm, permanently**. A
 * reinstall does not repair it either: hydration replays the feed, and the row
 * is not in the feed. It is silent, one-sided, and the only person who ever sees
 * the record is whoever was holding the phone that died.
 *
 * That is the last open box on P0-2, and this is it.
 *
 * ## An hour, because that is how long self-healing takes
 *
 * A row younger than that is very probably about to be resent by a client
 * that has merely lost signal, and sweeping it early would do the work twice
 * for no gain. Older than that, the ordinary explanation has run out.
 *
 * Nothing breaks if the sweeper and a resend collide: both go through
 * `inCommitOrder`, so they are serialised per farm, and `stampOutcome`'s filter
 * carries the undecided state so only the first decision sticks.
 *
 * ## Identity from the log, role from the database
 *
 * `project()` takes claims, and the sweeper has no session. It is not free to
 * invent one — invariant 8 says authorization is re-derived on every mutation,
 * and `project`'s own comment adds that *"a role revoked since the command was
 * queued must still bite."*
 *
 * So the two halves come from different places, which is what that invariant
 * actually asks for: **who** from the log, because the envelope records the
 * person who queued it and that fact cannot change; **what they may do** from
 * `users` right now, because that is the only current answer. A hand promoted
 * since sweeps as an owner; an owner demoted since sweeps as a hand.
 *
 * **And an author who is no longer a member of the farm is a refusal, not a
 * skip.** Leaving the row pending would put it back in the limbo this exists to
 * end — swept every hour for ever, reaching nobody. Stamping it `rejected`
 * decides it, which lets the feed move past it and lets the log say what
 * happened. The record is not lost: the envelope stays in `mutations`, which is
 * the audit trail, exactly as it does for every other refusal.
 */

/** An hour, in the units `Date` counts in. */
export const SWEEP_AFTER_MS = 60 * 60 * 1000;

/**
 * The two states a pass will pick a row up from.
 *
 * `pending` is the row whose client never came back. `unreadable` is one this
 * build looked at and could not parse — stamped rather than left `pending`,
 * because `readSnapshotPage` *stops* at a `pending` row and one of those was a
 * permanent full stop for every device on the farm. Selecting it here is the
 * other half of that: stamping it moved the feed on, and this is what still
 * lets a build that can read the envelope decide it properly.
 *
 * Including it costs nothing a pass was not already paying — these rows were
 * `pending` before, and consumed the same budget in the same order.
 */
const LOOKS_AT: StoredOutcome[] = [PENDING, UNREADABLE];

/**
 * How many stranded rows one query asks for.
 *
 * **`findMany` caps at 200 when nothing says otherwise, and nothing did.** A
 * farm with three hundred stranded rows therefore had a hundred of them left
 * untouched every pass, silently — which is the same class of defect
 * `sweepAllFarms` writes a loop to avoid one level up, and it was sitting in
 * the default argument of the call underneath. Paging is the fix; the number is
 * just how much is held in memory at a time.
 */
const SWEEP_PAGE = 200;

/**
 * The most rows one farm gets in one pass, so a pass is bounded.
 *
 * A ceiling rather than no ceiling because this runs on a timer and shares a
 * box with the service farms are syncing to: a backlog of a hundred thousand
 * rows should be worked through over several hours rather than in one pass that
 * holds a farm's write lane, row by row, for as long as it takes.
 *
 * Reaching it is not a loss — every unswept row is still `pending`, and the
 * next pass starts where this one stopped. It is reported through `capped` so
 * that "stopped early" and "found everything" are not the same silence.
 */
export const SWEEP_CEILING = 5_000;

export interface SweepReport {
  /** Rows that were old enough to look at. */
  found: number;
  /** Rows that reached a decision, whatever it was. */
  decided: number;
  /** Rows this build could not read back, left alone for a newer one. */
  unreadable: number;
  /** Rows whose author is no longer a member here. */
  orphaned: number;
  /** Rows the author's current role does not permit. */
  refused: number;
  /**
   * True when a farm hit `SWEEP_CEILING` with rows still waiting.
   *
   * **Reported rather than left silent**, which is the whole reason it exists:
   * a pass that quietly stops short and a pass that found everything look
   * identical in a log, and the second is the one an operator will assume.
   */
  capped: boolean;
}

const NOTHING: SweepReport = {
  found: 0,
  decided: 0,
  unreadable: 0,
  orphaned: 0,
  refused: 0,
  capped: false,
};

function add(a: SweepReport, b: Partial<SweepReport>): SweepReport {
  return {
    found: a.found + (b.found ?? 0),
    decided: a.decided + (b.decided ?? 0),
    unreadable: a.unreadable + (b.unreadable ?? 0),
    orphaned: a.orphaned + (b.orphaned ?? 0),
    refused: a.refused + (b.refused ?? 0),
    capped: a.capped || (b.capped ?? false),
  };
}

/**
 * What this person may do on this farm, as things stand.
 *
 * Null when the answer is "nothing" — no such user, a member of a different
 * farm, or an account that has been removed. Each of those makes the queued
 * command a refusal rather than something to hold on to.
 */
async function currentClaims(orgId: string, userId: string): Promise<SessionClaims | null> {
  const user = await findUserById(userId);
  if (user === null) return null;
  if (user.orgId !== orgId) return null;
  if (user.disabledAt !== undefined) return null;

  const role: Role = user.role;
  return { userId: user._id, orgId, role };
}

/**
 * One farm's undecided rows, oldest first.
 *
 * Oldest first because a later mutation against the same record may depend on
 * an earlier one having landed — the same reason the feed is ordered by
 * `(serverTs, _id)` and the client re-sorts a page it receives out of order.
 * Sweeping newest-first would apply an update before the create it edits.
 *
 * `outcome: PENDING` exactly, never the absent-or-null case `replayFromLog`
 * also treats as undecided. Those are rows written before the field existed:
 * they projected when they were first applied and they replicate today, so
 * sweeping them would re-project a farm's entire history on the hour.
 */
export async function sweepFarm(
  scope: Scoped,
  now: number,
  olderThanMs: number = SWEEP_AFTER_MS,
): Promise<SweepReport> {
  const cutoff = new Date(now - olderThanMs);
  let report = { ...NOTHING };

  /**
   * Where the last page ended, as the same `(serverTs, _id)` pair the feed
   * seeks on.
   *
   * **Not simply re-running the query**, which looks like it would work: a
   * swept row stops being `pending`, so the next call would return the next
   * rows on its own — until it met one this build cannot read, which is stamped
   * `unreadable` and deliberately still selected below, so a newer build can
   * come back to it. That row would come back at the head of every page for
   * ever and the loop would never finish. Seeking past what has been looked at
   * terminates whatever each row turned out to be.
   */
  let after: { serverTs: Date; _id: string } | null = null;

  while (report.found < SWEEP_CEILING) {
    const page = await scope.col<MutationDoc>('mutations').findMany(
      after === null
        ? { outcome: { $in: LOOKS_AT }, serverTs: { $lt: cutoff } }
        : {
            outcome: { $in: LOOKS_AT },
            $and: [
              { serverTs: { $lt: cutoff } },
              {
                $or: [
                  { serverTs: { $gt: after.serverTs } },
                  { serverTs: after.serverTs, _id: { $gt: after._id } },
                ],
              },
            ],
          },
      { limit: SWEEP_PAGE, sort: { serverTs: 1, _id: 1 } },
    );

    if (page.length === 0) return report;

    report = add(report, { found: page.length });
    for (const row of page) {
      report = add(report, await sweepOne(scope, row._id, row.userId));
    }

    const last = page[page.length - 1];
    if (last === undefined) return report;
    after = { serverTs: last.serverTs, _id: last._id };

    // A short page is the end of the set, so there is nothing to seek past.
    if (page.length < SWEEP_PAGE) return report;
  }

  /**
   * Stopped at the ceiling with rows still behind it. Said out loud through
   * `capped`, and the next pass picks up where this one left off — the rows are
   * still `pending`, which is the only state this whole mechanism reads.
   */
  return add(report, { capped: true });
}

async function sweepOne(
  scope: Scoped,
  id: string,
  userId: unknown,
): Promise<Partial<SweepReport>> {
  /**
   * The same lane every request holds, so a resend arriving mid-sweep waits
   * rather than projecting the same envelope alongside it.
   *
   * Per row rather than per farm: a sweep of a hundred rows must not hold one
   * farm's writes for the length of it, and each row is independent.
   */
  return inCommitOrder(scope.orgId, async () => {
    // Re-read inside the lane. A client that came back between the query above
    // and this moment has already decided the row, and the sweeper must not
    // project it a second time.
    const replay = await replayFromLog(scope, id);
    if (replay.kind === 'decided') return {};

    /**
     * Looked at, could not read — and said so on the row.
     *
     * **This used to return without stamping anything**, leaving the row
     * `pending` so a newer build could read it. The intent was right; the state
     * was not. `readSnapshotPage` *stops* at a `pending` row rather than
     * skipping it, and does not advance `through` — so a single row whose
     * payload no longer parses after a schema tightening was a permanent full
     * stop for the whole farm's feed, on every device, while each client was
     * answered `duplicate`, cleared its outbox row, and reported itself up to
     * date. Silent in both directions.
     *
     * `unreadable` is decided as far as the feed is concerned and unsettled as
     * far as this sweeper is concerned: `FINAL_OUTCOMES` excludes it, so a
     * later build that *can* read the envelope may still stamp the real
     * outcome, and `LOOKS_AT` is what brings the row back to be offered one.
     */
    if (replay.kind === 'unreadable') {
      await stampOutcome(scope, id, {
        kind: UNREADABLE,
        reason: 'This record could not be read back by the server that stored it.',
      });
      return { unreadable: 1 };
    }

    if (typeof userId !== 'string') {
      await stampOutcome(scope, id, {
        kind: UNREADABLE,
        reason: 'This record does not say who wrote it.',
      });
      return { unreadable: 1 };
    }

    const claims = await currentClaims(scope.orgId, userId);
    if (claims === null) {
      await stampOutcome(scope, id, {
        kind: 'rejected',
        reason: 'The person who recorded this is no longer on this farm.',
      });
      return { decided: 1, orphaned: 1 };
    }

    /**
     * The role gate, which `project()` does not carry.
     *
     * **This was missing, and its own test found it.** `decideProjection` takes
     * an `actor` and consults it for exactly two things — whether a hand may
     * stamp a photo it just uploaded, and whether somebody may edit a note they
     * did not write. The general question, *may this role do this at all*, is
     * `canMutate`, and `applyMutation` asks it **before** the lane and outside
     * `project()`. A sweeper that goes straight to `project()` therefore applied
     * every stranded row whatever its author is now allowed to do.
     *
     * That is a fail-open on authorization, which invariant 10 forbids outright,
     * and it is worse here than in a request: nobody is watching, and the row
     * being swept is by definition one whose author never came back to be told.
     *
     * Asked in the same shape as `applyMutation`, `isUploadStamp` included — a
     * hand's `photo:update` carrying only `uploadedAt` is the one mutation
     * `canMutate` refuses and the server must still accept, and a sweep that
     * dropped it would leave a photo on the server invisible to every device.
     */
    const { entity, op, payload } = replay.command;
    if (!canMutate(claims.role, entity, op) && !isUploadStamp(entity, op, payload)) {
      await stampOutcome(scope, id, { kind: 'rejected', reason: roleRefusal(op, entity) });
      return { decided: 1, refused: 1 };
    }

    const decision = await project(scope, claims, replay.command);
    await stampOutcome(scope, id, decision);
    return { decided: 1 };
  });
}

/**
 * Every farm on this server.
 *
 * The deployment is one API process per farm — `org-lane.ts` states that
 * assumption and both the lane and `commit-order.ts` already rest on it — so in
 * practice this loop has one entry. It is written as a loop anyway because *"a
 * sweeper that silently covered one farm on a box holding two would be the
 * quietest possible bug"*.
 *
 * **It was that bug, at two hundred.** The loop ran over `listOrgs()`, whose
 * limit defaults to 200 and which sorts newest first — so on a box with more
 * farms than that, the oldest were never swept, and the loop written to prevent
 * exactly this outcome produced it with a different number in it. `listOrgIds`
 * is unbounded and returns ids only, which is all this needs.
 */
export async function sweepAllFarms(
  now: number = Date.now(),
  olderThanMs: number = SWEEP_AFTER_MS,
): Promise<SweepReport> {
  const database = await db();
  let report = NOTHING;

  for (const orgId of await listOrgIds()) {
    report = add(report, await sweepFarm(scopedOn(database, orgId), now, olderThanMs));
  }

  return report;
}

/**
 * How often the pass runs.
 *
 * The same hour as the threshold, which is what P0-2's remedy asks for. It
 * means a stranded row waits somewhere between one and two hours to be
 * decided, and that is the right trade: the cost of waiting is that one record
 * is late to the farm's other phone, and the cost of sweeping aggressively is
 * re-projecting envelopes whose client was about to resend them anyway.
 */
export const SWEEP_EVERY_MS = SWEEP_AFTER_MS;

/**
 * And a first pass shortly after boot, because a restart is exactly when a
 * stranded row exists.
 *
 * The window this closes is a crash between the log write and the projection,
 * and the commonest cause of one is the process going down — so waiting a full
 * hour after coming back up would be waiting through the most likely moment for
 * there to be something to find. A minute, so it does not compete with startup.
 */
const SETTLE_MS = 60 * 1000;

export interface SweeperOptions {
  /** How often a pass runs. Defaults to `SWEEP_EVERY_MS`. */
  everyMs?: number;
  /** How long after start the first pass runs. Defaults to a minute. */
  settleMs?: number;
  /** Where a line goes when there is something to say. */
  report?: (line: string) => void;
  /**
   * What a pass does. Defaults to sweeping every farm.
   *
   * A parameter rather than a module reference the tests reach around, because
   * the runner's job **is** scheduling and what it schedules is the one thing it
   * does not decide. Spying on the module namespace does not work here and
   * should not: an ESM call site holds the local binding, so a namespace spy
   * silently fails to intercept and the test passes for the wrong reason — which
   * is exactly what happened when this was written the other way.
   */
  sweep?: () => Promise<SweepReport>;
  /** The clock `lastSweep` stamps with, so a test need not use the real one. */
  now?: () => Date;
  /**
   * Where the durable record goes. A seam for the same reason `sweep` is one —
   * a test of scheduling should not need a database to run.
   */
  persist?: (record: Parameters<typeof recordSweep>[0]) => Promise<void>;
  /** When this process started, for the row that says which process wrote it. */
  bootedAt?: Date;
}

/**
 * Runs the sweep on a timer until the returned function is called.
 *
 * ## Three things a background timer has to get right, and none is optional
 *
 * **It must not overlap itself.** A farm with a long backlog could otherwise
 * have two passes projecting the same envelopes at once. They would be
 * serialised by the lane and `stampOutcome` would keep only the first decision,
 * so it is not a correctness hole — but it is wasted work that grows exactly
 * when the server is already behind.
 *
 * **It must not throw.** An unhandled rejection inside a timer callback takes
 * the process down, and a sweeper that kills the API is worse than no sweeper.
 * A failed pass is logged and the next one tries again; there is no state to
 * lose, because every row it did not reach is still `pending`.
 *
 * **It must not hold the process open.** `unref()` so a shutdown does not wait
 * out an hour of timer, which is the difference between a clean restart and
 * systemd deciding the unit failed to stop.
 */
/**
 * Lets the process exit without waiting an hour for a timer.
 *
 * Node's timers return a handle carrying `unref`; the DOM's return a number.
 * This program's `tsconfig` has `lib: ["dom", ...]` because it also compiles
 * the shared packages, so the ambient `setTimeout` is typed as the DOM's — and
 * importing from `node:timers` does not help, since those exports are declared
 * in terms of the same shadowed global.
 *
 * Narrowed structurally rather than cast. A cast would assert a fact about the
 * runtime that the types disagree with, and this asks the value instead: on
 * Node it unrefs, and anywhere else it does nothing, which is the correct
 * behaviour in both places.
 */
function unref(handle: unknown): void {
  if (typeof handle !== 'object' || handle === null || !('unref' in handle)) return;
  const { unref: fn } = handle;
  if (typeof fn === 'function') fn.call(handle);
}

/**
 * How the last pass went, for anything that wants to look.
 *
 * **The sweep's own output went to `console.log` and nowhere a person reads.**
 * That is fine for the ordinary hour, which says nothing at all — and useless
 * for the question an operator actually has, which is *did this run, and did it
 * find anything*. A silent journal and a broken timer look identical.
 *
 * In memory and lost on restart, which is right for what this is: a reading of
 * **this process**. `at` being null means no pass has completed since boot,
 * which on a freshly restarted server is the truth rather than a fault.
 *
 * **It is not what the operations board reads, and it never could have been.**
 * The board is a separate systemd unit in a separate process, so a module
 * variable written here was invisible to it — the panel built because *"a
 * silent journal and a broken timer look identical"* reported "no pass since
 * boot" for ever, on every box. `db/sweep-status.ts` is the durable mirror the
 * board reads; this stays because it is the cheaper and more immediate answer
 * for anything inside this process, and because the two say different things:
 * one is what this process did, the other is what any process last did.
 */
export interface SweepStatus {
  at: Date | null;
  report: SweepReport | null;
  /** The message from a pass that threw, so a failing sweeper is visible. */
  failed: string | null;
}

let status: SweepStatus = { at: null, report: null, failed: null };

export function lastSweep(): SweepStatus {
  return status;
}

/** For a test that needs a process which has not swept yet. */
export function forgetLastSweep(): void {
  status = { at: null, report: null, failed: null };
}

export function startSweeper(options: SweeperOptions = {}): () => void {
  const {
    everyMs = SWEEP_EVERY_MS,
    settleMs = SETTLE_MS,
    report = console.log,
    sweep = sweepAllFarms,
    now = () => new Date(),
    persist = recordSweep,
    bootedAt = new Date(Date.now() - Math.floor(process.uptime() * 1000)),
  } = options;

  let running = false;

  const pass = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const swept = await sweep();
      const at = now();
      status = { at, report: swept, failed: null };
      await persist({ at, host: hostname(), startedAt: bootedAt, report: swept });
      // Silent on the ordinary hour, which is every hour. A line per pass would
      // bury the one that matters in a log nobody then reads.
      if (swept.found > 0) {
        report(
          `sweeper: ${swept.found} undecided, ${swept.decided} decided` +
            `${swept.orphaned > 0 ? `, ${swept.orphaned} orphaned` : ''}` +
            `${swept.refused > 0 ? `, ${swept.refused} refused` : ''}` +
            `${swept.unreadable > 0 ? `, ${swept.unreadable} unreadable` : ''}` +
            `${swept.capped ? ', stopped at the ceiling with more to do' : ''}`,
        );
      }
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      const at = now();
      status = { at, report: null, failed: why };
      await persist({ at, host: hostname(), startedAt: bootedAt, failed: why });
      report(`sweeper: pass failed — ${why}`);
    } finally {
      running = false;
    }
  };

  const settle = setTimeout(() => void pass(), settleMs);
  const every = setInterval(() => void pass(), everyMs);
  unref(settle);
  unref(every);

  return () => {
    clearTimeout(settle);
    clearInterval(every);
  };
}
