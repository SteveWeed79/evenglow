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

  // Still worth a console line: Metro is where somebody debugging is looking,
  // and the point of this module is that the same fact reaches both places.
  console.error(`[steading] ${where}: ${current.message}`, current.at ?? '');
  publish();
}

/** Cleared when somebody has read it, or when a later read succeeds. */
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
  listeners.clear();
}
