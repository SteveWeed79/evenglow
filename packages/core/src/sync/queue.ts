import { newId, payloadSchemaFor, type Entity, type Op } from '@steading/contracts';
import { InvalidMutationError, StorageFullError } from '../db/errors';
import type { IntegrityReport } from '../db/port';
import { localStore } from '../db/store';
import type { QueuedMutation } from '../db/records';

export { InvalidMutationError, StorageFullError };

/**
 * The outbox. Everything the app writes goes through enqueue() — there is no
 * direct-to-network path, online or not, because a write that sometimes skips
 * the queue is a write that sometimes gets lost.
 */

export interface EnqueueInput {
  entity: Entity;
  op: Op;
  /** Minted by the caller when creating, so offline records can reference each other (D1). */
  targetId?: string;
  payload: unknown;
}

/**
 * Enqueues a mutation and applies its optimistic projection.
 *
 * Validation lives here, storage lives in the LocalStore. The atomicity that
 * matters — mint the sequence number, write the outbox entry, advance the
 * counter and update the projection as ONE unit — is the store's guarantee
 * now, stated in `port.ts` and asserted against every implementation. That is
 * what lets the same suite prove IndexedDB and SQLite alike.
 */
export async function enqueue(input: EnqueueInput): Promise<QueuedMutation> {
  const targetId = input.targetId ?? newId();

  // Refuse locally what the server would refuse anyway, so an impossible
  // mutation never occupies the queue or the rejected inbox.
  const schema = payloadSchemaFor(input.entity, input.op);
  if (!schema) {
    throw new InvalidMutationError(`A ${input.entity} cannot be ${input.op}d.`);
  }

  const payload = schema.safeParse(input.payload);
  if (!payload.success) {
    throw new InvalidMutationError(
      payload.error.issues[0]?.message ?? `That ${input.entity} has a bad value.`,
    );
  }

  // Storage is the store's job from here. Everything above is contract
  // validation, which is the same whatever is underneath.
  const queued = await localStore().enqueue({
    entity: input.entity,
    op: input.op,
    targetId,
    payload: payload.data,
  });

  return queued;
}

export async function queueDepth(): Promise<number> {
  return (await localStore().counts()).queued;
}

export async function rejectedCount(): Promise<number> {
  return (await localStore().counts()).rejected;
}
/** Unsent work that a sign-out would destroy. The user is warned with this. */
export async function unsentCount(): Promise<number> {
  const { queued, rejected } = await localStore().counts();
  return queued + rejected;
}

/**
 * Cheap loss detection (masterplan Q1, salvaged item 1).
 *
 * clientSeq increments exactly once per enqueue, so nextClientSeq is also the
 * lifetime enqueue count. Subtract what the server acknowledged and the
 * result is how many entries the outbox should still hold. A shortfall means
 * records disappeared — eviction, a failed migration, a devtools wipe.
 *
 * Detects what comparing two local copies would have detected, using two
 * integers instead of a duplicate of the entire store.
 */
export async function checkIntegrity(): Promise<IntegrityReport> {
  return localStore().checkIntegrity();
}

export type { IntegrityReport };
