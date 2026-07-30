/**
 * One lane for every SQL operation on one database file.
 *
 * The driver used to serialise transactions only, and route everything else
 * onto whichever connection happened to be open. That routing was a decision
 * made from ambient state — "is a transaction running right now?" — and ambient
 * state cannot tell a statement that belongs to the transaction from a
 * screen refresh that merely coincided with it. Today's list issues eleven
 * reads in one burst on every engine publish, so the coincidence is not rare;
 * it is the normal case.
 *
 * A single lane removes the question rather than answering it. Nothing else
 * runs while a transaction is open, so nothing else can be misrouted into one,
 * and no statement can still be in flight against the transaction's connection
 * when that connection is closed.
 *
 * The lane is FIFO and explicit rather than a `tail.then(...)` chain, because
 * the stall guard below has to be able to reach into the queue and fail what is
 * waiting. A promise chain has no handle on its own links.
 */

/** Raised when the lane's holder went quiet while work was queued behind it. */
export class SqlStalledError extends Error {
  constructor(afterMs: number) {
    super(
      `A database transaction issued no statement for ${afterMs}ms while other work waited. ` +
        'The usual cause is a transaction body calling the outer driver instead of the ' +
        'handle passed to it — see SqlDriver.transaction.',
    );
    this.name = 'SqlStalledError';
  }
}

/** Cancels a pending timer. */
export type CancelTimer = () => void;

export interface GateOptions {
  /**
   * How long a transaction may issue no statement, with work queued behind it,
   * before that work is failed instead of left hanging.
   *
   * Every transaction in `LocalStore` is pure SQL plus JSON and Zod — none of
   * them await anything but the database — so silence this long is not slow
   * work, it is a transaction waiting on the lane it is itself holding. That is
   * a deadlock, and a deadlock on a handset is the one failure this codebase
   * has repeatedly paid for: it produces no message, no log line, and no crash
   * report. A named error is worth the small risk of failing a genuinely slow
   * pull page.
   */
  stallMs?: number;

  /** Injectable so the guard is testable without waiting. Defaults to timers. */
  schedule?: (ms: number, fire: () => void) => CancelTimer;
}

export interface Gate {
  /**
   * Runs `work` once everything queued before it has settled.
   *
   * `guarded` marks a holder that must keep issuing statements — a transaction.
   * A single statement is never guarded: a slow query is slow, not stuck, and
   * failing readers behind it would be a worse bug than the one being fixed.
   */
  enter<T>(work: (beat: () => void) => Promise<T>, guarded?: boolean): Promise<T>;
}

interface Ticket {
  begin: () => void;
  fail: (error: Error) => void;
}

export function createGate(options: GateOptions = {}): Gate {
  const stallMs = options.stallMs ?? 5_000;
  const schedule =
    options.schedule ??
    ((ms, fire): CancelTimer => {
      const handle = setTimeout(fire, ms);
      return () => clearTimeout(handle);
    });

  const queue: Ticket[] = [];
  let busy = false;
  let cancelStall: CancelTimer | null = null;

  const disarm = (): void => {
    cancelStall?.();
    cancelStall = null;
  };

  const arm = (): void => {
    disarm();
    cancelStall = schedule(stallMs, () => {
      cancelStall = null;
      // Nothing waiting means nothing is being harmed by the silence.
      if (queue.length === 0) return;

      const doomed = queue.splice(0, queue.length);
      const error = new SqlStalledError(stallMs);
      for (const ticket of doomed) ticket.fail(error);

      // Re-armed: the holder may be blocked on something that was never queued
      // here at all, and the next arrival deserves the same answer rather than
      // an unbounded wait.
      if (busy) arm();
    });
  };

  const pump = (): void => {
    if (busy) return;
    const next = queue.shift();
    if (next === undefined) return;
    busy = true;
    next.begin();
  };

  return {
    enter<T>(work: (beat: () => void) => Promise<T>, guarded = false): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const ticket: Ticket = {
          begin: () => {
            if (guarded) arm();
            void (async () => {
              try {
                resolve(await work(guarded ? arm : () => undefined));
              } catch (error) {
                reject(error);
              } finally {
                busy = false;
                disarm();
                pump();
              }
            })();
          },
          // A failed ticket never begins, so the lane is not left thinking it
          // ran. It is already spliced out of the queue by the caller.
          fail: reject,
        };

        queue.push(ticket);
        pump();
      });
    },
  };
}
