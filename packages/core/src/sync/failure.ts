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
 * The sentence that changes what somebody does next: it was not saved, so do
 * not walk away. That part is written for a person holding a bucket and comes
 * first, always.
 */
const UNKNOWN = 'That did not save. Your count is still here — try again.';

/**
 * ...and then what actually went wrong.
 *
 * This used to stop at the sentence above, on the argument that a raw
 * "AbortError: transaction aborted" tells a keeper nothing and reads like the
 * app blaming them. That argument is right about the FIRST line and was wrong
 * to end there — it threw away the only evidence the failure produced.
 *
 * It cost this project twice in one week. A save failed on a handset, the
 * screen said this exact sentence, and there was nothing to go on: not the
 * call, not the file, not whether it was storage, the network or a missing
 * global. Both times the next step was a round trip to ask.
 *
 * A person can ignore a second line. Nobody can debug a missing one.
 */
function detailOf(error: unknown): string | null {
  if (error instanceof Error && error.message !== '') return error.message;
  if (typeof error === 'string' && error !== '') return error;
  return null;
}

export function describeLogFailure(error: unknown): string {
  // Both carry messages written for this screen, so they pass through intact.
  if (error instanceof StorageFullError) return error.message;
  if (error instanceof InvalidMutationError) return error.message;

  const detail = detailOf(error);
  return detail === null ? UNKNOWN : `${UNKNOWN}\n\n${detail}`;
}
