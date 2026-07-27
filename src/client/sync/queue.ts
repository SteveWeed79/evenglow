import {
  MUTATION_SCHEMA_VERSION,
  mutationSchema,
  newId,
  payloadSchemaFor,
  type Entity,
  type Mutation,
  type Op,
} from '@steading/contracts';
import { db } from '../db/open';
import { toLocalRecord } from '../db/project';
import { META, parseMeta, type QueuedMutation, STORES } from '../db/schema';

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

export class InvalidMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMutationError';
  }
}

/**
 * The device has no room left. Distinct from InvalidMutationError because the
 * mutation is fine — the storage is not — and the two need different advice.
 */
export class StorageFullError extends Error {
  constructor() {
    super('This device is out of space. Sync to free room, then try again.');
    this.name = 'StorageFullError';
  }
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' ||
      // Safari's older spelling.
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

/**
 * Enqueues a mutation and applies its optimistic projection.
 *
 * The whole thing is ONE IndexedDB transaction: mint the sequence number,
 * write the outbox entry, advance the counter, and update the local record
 * together. Assigning clientSeq outside the transaction is the classic way to
 * end up with two mutations holding the same sequence number after a crash
 * mid-write — at which point ordering (A4) is quietly broken and nothing
 * reports it.
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

  const database = await db();
  const tx = database.transaction([STORES.outbox, STORES.meta, STORES.records], 'readwrite');
  const meta = tx.objectStore(STORES.meta);

  // A corrupt or missing deviceId is safe to replace: it only groups a
  // device's own mutations for ordering, and a new one starts a new group.
  let deviceId = parseMeta('deviceId', await meta.get(META.deviceId));
  if (deviceId === undefined) {
    deviceId = crypto.randomUUID();
    await meta.put(deviceId, META.deviceId);
  }

  // A corrupt or missing nextClientSeq is NOT safe to replace with zero —
  // that reuses sequence numbers and silently breaks ordering. Take the
  // highest seq still in the outbox as a floor, so monotonicity survives
  // losing the counter as long as the queue itself survived.
  const stored = parseMeta('nextClientSeq', await meta.get(META.nextClientSeq)) ?? 0;
  const highest = await tx.objectStore(STORES.outbox).index('byClientSeq').openCursor(null, 'prev');
  const floor = highest ? highest.value.clientSeq + 1 : 0;
  const clientSeq = Math.max(stored, floor);

  const envelope: Mutation = {
    schemaVersion: MUTATION_SCHEMA_VERSION,
    id: newId(),
    targetId,
    entity: input.entity,
    op: input.op,
    payload: payload.data,
    deviceId,
    clientSeq,
    clientTs: Date.now(), // recorded, never trusted for ordering (D6)
  };

  // Belt and braces: the envelope is validated before it can reach storage,
  // so a malformed record cannot be created by a bug upstream of here.
  const checked = mutationSchema.safeParse(envelope);
  if (!checked.success) {
    tx.abort();
    throw new InvalidMutationError('Could not build a valid mutation.');
  }

  const queued: QueuedMutation = {
    ...envelope,
    status: 'queued',
    attempts: 0,
    enqueuedAt: Date.now(),
  };

  // Same builder hydration uses, so a device's own writes and the same writes
  // arriving back from the server cannot disagree.
  const record = toLocalRecord(input.entity, targetId, input.op, payload.data, Date.now());

  try {
    await tx.objectStore(STORES.outbox).put(queued);
    await meta.put(clientSeq + 1, META.nextClientSeq);
    await tx.objectStore(STORES.records).put(record);
    await tx.done;
  } catch (error) {
    // A full disk must fail the log loudly rather than half-write it. The
    // transaction aborts as a unit, so no sequence number is consumed and
    // nothing partial is left behind.
    if (isQuotaError(error)) throw new StorageFullError();
    throw error;
  }

  return queued;
}

export async function queueDepth(): Promise<number> {
  return (await db()).countFromIndex(STORES.outbox, 'byStatus', 'queued');
}

export async function rejectedCount(): Promise<number> {
  return (await db()).countFromIndex(STORES.outbox, 'byStatus', 'rejected');
}
/** Unsent work that a sign-out would destroy. The user is warned with this. */
export async function unsentCount(): Promise<number> {
  const database = await db();
  const [queued, rejected] = await Promise.all([
    database.countFromIndex(STORES.outbox, 'byStatus', 'queued'),
    database.countFromIndex(STORES.outbox, 'byStatus', 'rejected'),
  ]);
  return queued + rejected;
}

export interface IntegrityReport {
  everEnqueued: number;
  cleared: number;
  expectedInOutbox: number;
  actualInOutbox: number;
  /** Positive when records left storage without the server ever acknowledging them. */
  missing: number;
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
  const database = await db();
  const tx = database.transaction([STORES.outbox, STORES.meta], 'readonly');
  const meta = tx.objectStore(STORES.meta);

  const everEnqueued = parseMeta('nextClientSeq', await meta.get(META.nextClientSeq)) ?? 0;
  const cleared = parseMeta('clearedCount', await meta.get(META.clearedCount)) ?? 0;
  const actualInOutbox = await tx.objectStore(STORES.outbox).count();
  await tx.done;

  const expectedInOutbox = everEnqueued - cleared;

  return {
    everEnqueued,
    cleared,
    expectedInOutbox,
    actualInOutbox,
    missing: Math.max(0, expectedInOutbox - actualInOutbox),
  };
}
