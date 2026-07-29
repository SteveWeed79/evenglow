import { InvalidMutationError, StorageFullError } from './queue';

/**
 * Turns an enqueue failure into something a person holding a bucket can act on.
 *
 * This exists because every write path used to discard the rejection. The
 * Tally clears its count optimistically *before* awaiting the commit, so a
 * throw left the number at zero with nothing queued and nothing said — the
 * user's count silently gone, on the one interaction this app exists to make
 * reliable.
 *
 * Kept pure and separate from the components so the mapping is testable
 * without a DOM.
 */

/**
 * Deliberately not the raw `error.message` for the unknown case. An IndexedDB
 * abort reads like "AbortError: transaction aborted", which tells a keeper
 * nothing and looks like the app blaming them. What matters is the only fact
 * that changes their next action: it was not saved, so do not walk away.
 */
const UNKNOWN = 'That did not save. Your count is still here — try again.';

export function describeLogFailure(error: unknown): string {
  // Both carry messages written for this screen, so they pass through intact.
  if (error instanceof StorageFullError) return error.message;
  if (error instanceof InvalidMutationError) return error.message;
  return UNKNOWN;
}
