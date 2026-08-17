import type { Role } from '@steading/contracts';
import type { SessionClaims } from '../auth/claims';
import { findUserById, listOrgs } from '../db/identity';
import type { Scoped } from '../db/scoped';
import { scopedOn } from '../db/scoped';
import { db } from '../db/client';
import { inCommitOrder } from './commit-order';
import { PENDING } from './outcome';
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

export interface SweepReport {
  /** Rows that were old enough to look at. */
  found: number;
  /** Rows that reached a decision, whatever it was. */
  decided: number;
  /** Rows this build could not read back, left alone for a newer one. */
  unreadable: number;
  /** Rows whose author is no longer a member here. */
  orphaned: number;
}

const NOTHING: SweepReport = { found: 0, decided: 0, unreadable: 0, orphaned: 0 };

function add(a: SweepReport, b: Partial<SweepReport>): SweepReport {
  return {
    found: a.found + (b.found ?? 0),
    decided: a.decided + (b.decided ?? 0),
    unreadable: a.unreadable + (b.unreadable ?? 0),
    orphaned: a.orphaned + (b.orphaned ?? 0),
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
  const stale = await scope
    .col<MutationDoc>('mutations')
    .findMany(
      { outcome: PENDING, serverTs: { $lt: new Date(now - olderThanMs) } },
      { sort: { serverTs: 1, _id: 1 } },
    );

  let report = { ...NOTHING, found: stale.length };

  for (const row of stale) {
    report = add(report, await sweepOne(scope, row._id, row.userId));
  }

  return report;
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
    if (replay.kind === 'unreadable') return { unreadable: 1 };

    if (typeof userId !== 'string') return { unreadable: 1 };

    const claims = await currentClaims(scope.orgId, userId);
    if (claims === null) {
      await stampOutcome(scope, id, {
        kind: 'rejected',
        reason: 'The person who recorded this is no longer on this farm.',
      });
      return { decided: 1, orphaned: 1 };
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
 * practice this loop has one entry. It is written as a loop anyway because
 * `listOrgs` is what exists and a sweeper that silently covered one farm on a
 * box holding two would be the quietest possible bug.
 */
export async function sweepAllFarms(
  now: number = Date.now(),
  olderThanMs: number = SWEEP_AFTER_MS,
): Promise<SweepReport> {
  const database = await db();
  let report = NOTHING;

  for (const org of await listOrgs()) {
    report = add(report, await sweepFarm(scopedOn(database, org._id), now, olderThanMs));
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

export function startSweeper(options: SweeperOptions = {}): () => void {
  const {
    everyMs = SWEEP_EVERY_MS,
    settleMs = SETTLE_MS,
    report = console.log,
    sweep = sweepAllFarms,
  } = options;

  let running = false;

  const pass = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const swept = await sweep();
      // Silent on the ordinary hour, which is every hour. A line per pass would
      // bury the one that matters in a log nobody then reads.
      if (swept.found > 0) {
        report(
          `sweeper: ${swept.found} undecided, ${swept.decided} decided` +
            `${swept.orphaned > 0 ? `, ${swept.orphaned} orphaned` : ''}` +
            `${swept.unreadable > 0 ? `, ${swept.unreadable} unreadable` : ''}`,
        );
      }
    } catch (error) {
      report(`sweeper: pass failed — ${error instanceof Error ? error.message : String(error)}`);
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
