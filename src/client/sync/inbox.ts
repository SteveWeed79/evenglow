import { localStore } from '../db/store';
import type { QueuedMutation } from '../db/schema';

/**
 * The rejected-mutations inbox (A6).
 *
 * "Never drop a rejected mutation" is enforced by storage shape: a rejection
 * flips status and stays in the same store. The only paths out are the user
 * retrying it or the user explicitly discarding it. Nothing here runs on its
 * own — work never evaporates while a farmer is not looking.
 */

export async function listRejected(): Promise<QueuedMutation[]> {
  return localStore().listRejected();
}

/**
 * Puts a rejected mutation back in the queue, optionally with a corrected
 * payload. Attempts reset: the user has changed something, so the previous
 * failures are not evidence about this one.
 */
export async function retryRejected(id: string, payload?: unknown): Promise<void> {
  await localStore().retryRejected(id, payload);
}

/**
 * Discards a rejected mutation. Explicit user action only.
 *
 * Bumps the cleared counter alongside the delete: the integrity check derives
 * expected queue depth from enqueued-minus-cleared, so a discard that skipped
 * this would later be reported as data loss.
 */
export async function discardRejected(id: string): Promise<void> {
  await localStore().discardRejected(id);
}
