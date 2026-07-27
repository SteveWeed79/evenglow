import { type Entity, newId, type Op, payloadSchemaFor } from '@steading/contracts';
import { store } from '../db/open';
import type { IntegrityReport } from '../db/port';
import type { QueuedMutation } from '../db/schema';

/**
 * The outbox. Everything the app writes goes through enqueue() — there is no
 * direct-to-network path, online or not, because a write that sometimes skips
 * the queue is a write that sometimes gets lost.
 *
 * Validation lives here; atomicity lives in the store. The split is deliberate:
 * refusing an impossible mutation is a domain question, and writing the outbox
 * row and the projection as one unit is a storage question.
 */

export interface EnqueueInput {
  entity: Entity;
  op: Op;
  /** Minted by the caller when creating, so offline records can reference each other (D1). */
  targetId?: string;
  payload: unknown;
}

export class InvalidMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMutationError';
  }
}

export { StorageFullError } from '../db/driver';

/**
 * Enqueues a mutation and applies its optimistic projection.
 *
 * Both halves happen in one SQLite transaction inside the store (invariant 5).
 * A crash between them would leave the screen showing work the queue does not
 * hold, or hold work the screen does not show; neither is recoverable after the
 * fact, because nothing else knows what was intended.
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

  return (await store()).enqueue({
    entity: input.entity,
    op: input.op,
    targetId,
    payload: payload.data,
  });
}

export async function queueDepth(): Promise<number> {
  return (await (await store()).counts()).queued;
}

export async function rejectedCount(): Promise<number> {
  return (await (await store()).counts()).rejected;
}

export async function outboxSize(): Promise<number> {
  return (await (await store()).counts()).total;
}

/** Unsent work that a sign-out would destroy. The user is warned with this. */
export async function unsentCount(): Promise<number> {
  const counts = await (await store()).counts();
  return counts.queued + counts.rejected;
}

export type { IntegrityReport };

/**
 * Cheap loss detection (masterplan Q1, salvaged item 1).
 *
 * Detects what comparing two local copies would have detected, using a few
 * integers instead of a duplicate of the entire store. The arithmetic lives in
 * the store, since only storage knows what it quarantined.
 */
export async function checkIntegrity(): Promise<IntegrityReport> {
  return (await store()).checkIntegrity();
}
