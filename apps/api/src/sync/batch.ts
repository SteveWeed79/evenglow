import { syncRequestSchema, type SyncResponse } from '@steading/contracts';
import type { SessionClaims } from '../auth/claims';
import type { Scoped } from '../db/scoped';
import { HttpError } from '../http';
import { applyBatch } from './apply';

/**
 * The only write path for offline data, as a function of a scope and a body.
 *
 * Extracted for the same reason as the snapshot reader: both servers run this,
 * neither owns a copy. A batch endpoint that differed between them would show
 * up as mutations accepted by one server and rejected by the other, which the
 * client would surface to a user as work arbitrarily landing in the rejected
 * inbox depending on which host answered.
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
