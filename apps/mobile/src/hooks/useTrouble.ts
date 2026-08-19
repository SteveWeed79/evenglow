import { useSyncExternalStore } from 'react';

/**
 * When a read fails, somebody has to be told.
 *
 * Every live read in this app is driven by `subscribe(() => void refresh())`,
 * and `void` on a promise that rejects is an unhandled rejection: a red line
 * in Metro that names no file, and a screen that sits on its loading branch
 * forever. That combination produced a blank screen and the single least
 * useful sentence in the codebase — "undefined is not a function" — with
 * nothing to say which read, which screen, or which call.
 *
 * **Staying on the loading branch is deliberate, not a shortcut.** The obvious
 * repair is to give up and render the empty state, and that is the one thing
 * this app must never do: an empty list is indistinguishable from a farm with
 * no animals, which is the most dangerous thing it could tell someone. A
 * screen that could not read says so.
 *
 * Module-level rather than context, because the reads that report here are not
 * all under one provider, and a failure during boot has no tree to be inside
 * of yet.
 */

export interface Trouble {
  /** Where it happened, in words — "the stock list", not a stack frame. */
  where: string;
  message: string;
  /** The first frame that is ours, when the engine provides one. */
  at: string | null;
}

let current: Trouble | null = null;
const listeners = new Set<() => void>();

/**
 * What has gone wrong recently, as distinct from what is on screen now.
 *
 * **The banner and the history are different things and used to be one**, which
 * made the support loop impossible: `clearTrouble` fires the moment a later
 * read succeeds, so by the time somebody has noticed a problem, opened
 * Settings and found the support screen, the error they came to report has
 * been forgotten. A ticket carrying "nothing is currently wrong" is a ticket
 * nobody can act on.
 *
 * So this keeps its own record. Cleared by nothing except a process restart —
 * these are the engine's own failures on one device across one run, which is
 * exactly the window a report is about.
 *
 * ## Counted rather than repeated
 *
 * A read that fails every time the engine publishes fails a hundred times a
 * minute. Twenty copies of one message would push the twenty *different*
 * failures out of the buffer, which is the opposite of what a diagnosis needs.
 * Identical `where` and `message` bump a count instead.
 */
const HISTORY_LIMIT = 20;

export interface TroubleRecord extends Trouble {
  first: number;
  last: number;
  count: number;
}

const history: TroubleRecord[] = [];

/** Newest first, for a bundle. Copied, so a caller cannot edit the record. */
export function troubleHistory(): TroubleRecord[] {
  return history.map((record) => ({ ...record })).sort((a, b) => b.last - a.last);
}

function publish(): void {
  for (const listener of listeners) listener();
}

/**
 * Pulls the first stack frame that names a file of ours.
 *
 * Hermes stacks lead with framework frames, and the top one is almost never
 * the interesting line. Anything from `node_modules` is skipped for the same
 * reason a person reading it would skip it.
 */
function firstOwnFrame(error: unknown): string | null {
  if (!(error instanceof Error) || typeof error.stack !== 'string') return null;

  for (const line of error.stack.split('\n').slice(1)) {
    if (line.includes('node_modules')) continue;
    const trimmed = line.trim();
    if (trimmed !== '') return trimmed.slice(0, 160);
  }
  return null;
}

export function reportTrouble(where: string, error: unknown): void {
  current = {
    where,
    message: error instanceof Error ? error.message : String(error),
    at: firstOwnFrame(error),
  };

  remember(current);

  // Still worth a console line: Metro is where somebody debugging is looking,
  // and the point of this module is that the same fact reaches both places.
  console.error(`[homefarm] ${where}: ${current.message}`, current.at ?? '');
  publish();
}

/**
 * Records it in the history, which the banner's own lifecycle must not touch.
 *
 * Deduplicated on `where` and `message` so a read failing on every engine
 * publish does not evict the other nineteen failures — the ones that would
 * actually explain it.
 */
function remember(trouble: Trouble): void {
  const now = Date.now();
  const seen = history.find((r) => r.where === trouble.where && r.message === trouble.message);

  if (seen !== undefined) {
    seen.count += 1;
    seen.last = now;
    return;
  }

  history.push({ ...trouble, first: now, last: now, count: 1 });
  // Oldest out. A buffer that grew without bound on a device in a crash loop
  // would be the app's own memory leak inside its own diagnostics.
  if (history.length > HISTORY_LIMIT) history.shift();
}

/**
 * Cleared when somebody has read it, or when a later read succeeds.
 *
 * **The history is deliberately left alone.** This clears the banner; a
 * support bundle assembled afterwards still knows what happened, which is the
 * whole reason the two were separated.
 */
export function clearTrouble(): void {
  if (current === null) return;
  current = null;
  publish();
}

export function useTrouble(): Trouble | null {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => current,
    () => current,
  );
}

/** Tests only. */
export function resetTrouble(): void {
  current = null;
  history.length = 0;
  listeners.clear();
}
