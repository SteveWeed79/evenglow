import type { Collection } from 'mongodb';
import { db } from './client';

/**
 * How the last sweep went, written where another process can read it.
 *
 * ## The panel that could never say anything
 *
 * `sync/sweep.ts` kept this in a module variable, and argued for it: *"It
 * describes this process, and persisting it would make it a record of the farm
 * rather than a reading of the server."* That reasoning is right about what the
 * value **is** and was wrong about where it can live, because of a deployment
 * decision made after it: `startSweeper()` runs in the API process, and the
 * operations board is a **separate systemd unit** — its own entry point, on its
 * own port, so that `systemctl disable steading-ops` is a complete answer to
 * "take the admin surface off this box".
 *
 * Module state does not cross a process boundary. So the board read a variable
 * nothing in its process ever wrote, and its sweep panel reported "no pass has
 * completed since boot" for ever — on every box, at every moment, no matter how
 * the sweeper was actually doing. The panel exists because *"a silent journal
 * and a broken timer look identical"*, and as built it could not tell them
 * apart either.
 *
 * ## Still a reading of the server, and the row says so
 *
 * The original objection stands and is answered by scope rather than by
 * storage: this is one document with a fixed `_id`, holding no farm's data and
 * no farm's id, overwritten by every pass. It is not tenant data, which is why
 * it is here and not behind `scoped()` — there is no `orgId` to scope it by,
 * and inventing one would be worse than the problem.
 *
 * `host` and `startedAt` are what turn it from "the last pass" into "the last
 * pass, by that process". A stale row from a machine that has since been
 * replaced is a fact worth being able to see rather than one to be misled by.
 */

/** The fixed key. One row, always, so a pass overwrites rather than accumulates. */
const ID = 'sweep';

export interface SweepRecord {
  _id: string;
  /** When the pass finished. */
  at: Date;
  /** Which process wrote it, so a stale row is recognisable as one. */
  host: string;
  /** When that process started, for the same reason. */
  startedAt: Date;
  /** Absent when the pass threw — `failed` carries the reason instead. */
  report?: {
    found: number;
    decided: number;
    unreadable: number;
    orphaned: number;
    refused: number;
    /** True when the pass stopped at its own ceiling with rows still to do. */
    capped: boolean;
  };
  /** The message from a pass that threw. Absent on a pass that finished. */
  failed?: string;
}

async function statuses(): Promise<Collection<SweepRecord>> {
  return (await db()).collection<SweepRecord>('serverHealth');
}

/**
 * Records a finished pass, replacing whatever was there.
 *
 * **Never throws.** This is bookkeeping hanging off the side of a background
 * timer whose own contract is that it must not throw — a sweeper that kills the
 * API is worse than no sweeper, and one that dies because it could not write
 * down how it went would be exactly that, at the moment the database is already
 * unhappy. The caller decides nothing on the result.
 */
export async function recordSweep(record: Omit<SweepRecord, '_id'>): Promise<void> {
  try {
    await (await statuses()).updateOne({ _id: ID }, { $set: { ...record } }, { upsert: true });
  } catch {
    // Deliberately swallowed — see above.
  }
}

/**
 * The last pass, or null if no process has recorded one.
 *
 * Null is the honest answer on a server whose sweeper has not yet had its first
 * pass, and it is also the answer on a box where the API unit is not running at
 * all — which is a thing an operator very much wants the board to be able to
 * show them.
 */
export async function readSweep(): Promise<SweepRecord | null> {
  return (await statuses()).findOne({ _id: ID });
}
