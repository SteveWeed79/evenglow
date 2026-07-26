import { db, readOutboxBySeq } from '../db/open';
import { META, parseMeta, type QueuedMutation, STORES } from '../db/schema';

/**
 * The rejected-mutations inbox (A6).
 *
 * "Never drop a rejected mutation" is enforced by storage shape: a rejection
 * flips status and stays in the same store. The only paths out are the user
 * retrying it or the user explicitly discarding it. Nothing here runs on its
 * own — work never evaporates while a farmer is not looking.
 */

export async function listRejected(): Promise<QueuedMutation[]> {
  const all = await readOutboxBySeq();
  return all.filter((m) => m.status === 'rejected');
}

/**
 * Puts a rejected mutation back in the queue, optionally with a corrected
 * payload. Attempts reset: the user has changed something, so the previous
 * failures are not evidence about this one.
 */
export async function retryRejected(id: string, payload?: unknown): Promise<void> {
  const database = await db();
  const tx = database.transaction(STORES.outbox, 'readwrite');
  const outbox = tx.objectStore(STORES.outbox);

  const current = await outbox.get(id);
  if (!current) {
    await tx.done;
    return;
  }

  const { rejectedReason: _reason, rejectedAt: _at, lastError: _error, ...rest } = current;

  await outbox.put({
    ...rest,
    ...(payload === undefined ? {} : { payload }),
    status: 'queued',
    attempts: 0,
  });
  await tx.done;
}

/**
 * Discards a rejected mutation. Explicit user action only.
 *
 * Bumps the cleared counter alongside the delete: the integrity check derives
 * expected queue depth from enqueued-minus-cleared, so a discard that skipped
 * this would later be reported as data loss.
 */
export async function discardRejected(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction([STORES.outbox, STORES.meta], 'readwrite');
  const outbox = tx.objectStore(STORES.outbox);
  const meta = tx.objectStore(STORES.meta);

  const current = await outbox.get(id);
  if (!current || current.status !== 'rejected') {
    await tx.done;
    return;
  }

  await outbox.delete(id);
  const cleared = parseMeta('clearedCount', await meta.get(META.clearedCount)) ?? 0;
  await meta.put(cleared + 1, META.clearedCount);
  await tx.done;
}
