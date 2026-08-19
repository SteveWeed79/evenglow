import { syncRequestSchema, type SyncResponse } from '@homefarm/contracts';
import type { SessionClaims } from '../auth/claims';
import type { Scoped } from '../db/scoped';
import { HttpError } from '../http';
import { applyBatch } from './apply';

/**
 * The only write path for offline data, as a function of a scope and a body.
 *
 * Extracted for the same reason as the snapshot reader: the route is an
 * adapter and the rules are not in it. That began as a way to keep two live
 * servers from answering the same flush differently — the Next surface is now
 * deleted — and it is worth keeping for what it leaves behind: the whole write
 * path is reachable from a test with a `Scoped` and a body, without a route, a
 * port, or a framework.
 */
export async function handleSyncBatch(
  scope: Scoped,
  claims: SessionClaims,
  body: unknown,
): Promise<SyncResponse> {
  /**
   * `.strict()` is doing security work, not tidiness: a payload-supplied
   * `orgId` must be a hard 400 rather than a silently ignored field (C2). The
   * orgId comes from the verified session, only.
   */
  const parsed = syncRequestSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first && first.path.length > 0 ? ` (${first.path.join('.')})` : '';
    throw new HttpError(400, `That batch could not be read${where}.`);
  }

  return {
    results: await applyBatch(scope, claims, parsed.data.mutations),
    serverTs: Date.now(),
  };
}
