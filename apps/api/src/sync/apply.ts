import { MongoServerError } from 'mongodb';
import { payloadSchemaFor } from '@steading/contracts';
import {
  MUTATION_SCHEMA_VERSION,
  type Mutation,
  type MutationResult,
} from '@steading/contracts';
import { canMutate } from '@steading/contracts';
import type { SessionClaims } from '../auth/principal';
import type { Scoped, Tenanted } from '../db/scoped';
import {
  decideProjection,
  ENTITY_COLLECTIONS,
  type ProjectionDecision,
} from './projections';

/**
 * Per-mutation applier.
 *
 * Two writes per mutation, in this order:
 *  1. the mutation log, idempotently — the source of truth, and the audit
 *     trail D3 gives us for free;
 *  2. the domain projection, which is a derived read model.
 *
 * The order matters. If the process dies between them the log still holds the
 * mutation, so the projection can be rebuilt; the reverse would leave a
 * projected record with no record of what produced it.
 */

/** A device offline across two deploys must still sync: accept N and N−1. */
const MIN_ACCEPTED_SCHEMA_VERSION = MUTATION_SCHEMA_VERSION - 1;

interface MutationDoc extends Tenanted {
  targetId: string;
  entity: string;
  op: string;
  payload: unknown;
  deviceId: string;
  clientSeq: number;
  clientTs: number;
  schemaVersion: number;
  userId: string;
  serverTs: Date;
}

/** A projected domain record. Fields beyond these are entity-specific. */
interface ProjectedDoc extends Tenanted {
  archivedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  updatedBy?: string;
  updatedByDevice?: string;
}

function rejected(id: string, reason: string): MutationResult {
  return { id, status: 'rejected', reason };
}

export async function applyMutation(
  scope: Scoped,
  claims: SessionClaims,
  mutation: Mutation,
): Promise<MutationResult> {
  const { id, entity, op } = mutation;

  if (
    mutation.schemaVersion > MUTATION_SCHEMA_VERSION ||
    mutation.schemaVersion < MIN_ACCEPTED_SCHEMA_VERSION
  ) {
    return rejected(id, `This app version cannot read that record (v${mutation.schemaVersion}).`);
  }

  // Role is re-derived server-side, never read from the payload (invariant 5).
  if (!canMutate(claims.role, entity, op)) {
    return rejected(id, `Your role cannot ${op} a ${entity}.`);
  }

  // An absent schema means the op is forbidden for this entity — notably every
  // update/delete against an append-only entity (D3).
  const schema = payloadSchemaFor(entity, op);
  if (!schema) {
    return rejected(id, `A ${entity} cannot be changed once recorded.`);
  }

  const parsed = schema.safeParse(mutation.payload);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first && first.path.length > 0 ? ` (${first.path.join('.')})` : '';
    return rejected(id, `That ${entity} is missing or has a bad value${where}.`);
  }

  // Every entity schema produces an object. The check narrows `unknown`
  // without a cast, and guards against a schema that stops doing so.
  const payload: unknown = parsed.data;
  if (typeof payload !== 'object' || payload === null) {
    return rejected(id, `That ${entity} is not a valid record.`);
  }

  // No _id and no orgId here: Mongo derives _id from the upsert filter's
  // equality term, and scoped() stamps orgId. Both are rejected by
  // assertSafeUpdate if a caller passes them, which is the point.
  const doc: Omit<MutationDoc, 'orgId' | '_id'> = {
    targetId: mutation.targetId,
    entity,
    op,
    payload: parsed.data,
    deviceId: mutation.deviceId,
    clientSeq: mutation.clientSeq,
    clientTs: mutation.clientTs,
    schemaVersion: mutation.schemaVersion,
    userId: claims.userId,
    serverTs: new Date(),
  };

  let firstTime: boolean;
  try {
    // Idempotency (A3): $setOnInsert means a replayed batch writes nothing the
    // second time, and upsertedCount is what distinguishes the two cases.
    const res = await scope
      .col<MutationDoc>('mutations')
      .upsertOne({ _id: id }, { $setOnInsert: doc });
    firstTime = res.upsertedCount > 0;
  } catch (error) {
    // _id is unique collection-wide, so a mutation id already used by another
    // tenant fails the insert rather than matching the org-guarded filter.
    // Surfacing it as 'duplicate' would tell the caller a foreign id exists.
    if (error instanceof MongoServerError && error.code === 11000) {
      return rejected(id, 'That record id is already in use. The app will mint a new one.');
    }
    throw error;
  }

  // The projection runs even on a replay. It is idempotent by construction,
  // and running it means a projection lost to a crash between the two writes
  // repairs itself on the next flush rather than staying missing forever.
  const projection = await project(scope, claims, mutation, payload);

  if (projection.kind === 'conflict') {
    return { id, status: 'conflict', reason: projection.reason };
  }
  if (projection.kind === 'rejected') {
    return rejected(id, projection.reason);
  }

  return { id, status: firstTime ? 'applied' : 'duplicate' };
}

/** Writes the derived read model for one mutation. */
async function project(
  scope: Scoped,
  claims: SessionClaims,
  mutation: Mutation,
  payload: object,
): Promise<ProjectionDecision> {
  const collection = ENTITY_COLLECTIONS[mutation.entity];
  const col = scope.col<ProjectedDoc>(collection);

  const existing = await col.findOne({ _id: mutation.targetId });

  const decision = decideProjection(mutation.entity, mutation.op, payload, {
    existing,
    ...(mutation.entity === 'hourReading'
      ? { lastHours: await highestHours(scope, payload) }
      : {}),
  });

  const stamp = {
    updatedAt: new Date(),
    updatedBy: claims.userId,
    updatedByDevice: mutation.deviceId,
  };

  switch (decision.kind) {
    case 'insert':
      await col.upsertOne(
        { _id: mutation.targetId },
        { $setOnInsert: { ...payload, ...stamp, createdAt: new Date() } },
      );
      break;

    case 'update':
      await col.updateOne({ _id: mutation.targetId }, { $set: { ...payload, ...stamp } });
      break;

    case 'archive':
      // Archive, never delete — history survives (P13).
      await col.updateOne({ _id: mutation.targetId }, { $set: { archivedAt: new Date(), ...stamp } });
      break;

    case 'noop':
    case 'conflict':
    case 'rejected':
      break;
  }

  return decision;
}

/** The highest hours already recorded for the machine a reading belongs to. */
async function highestHours(scope: Scoped, payload: object): Promise<number | null> {
  const equipmentId = (payload as { equipmentId?: unknown }).equipmentId;
  if (typeof equipmentId !== 'string') return null;

  // One indexed read rather than pulling the series and reducing it — the
  // orgId+equipmentId+hours index makes this a single seek.
  const [highest] = await scope
    .col<ProjectedDoc & { equipmentId: string; hours: number }>('hourReadings')
    .findMany({ equipmentId }, { limit: 1, sort: { hours: -1 } });

  return highest?.hours ?? null;
}

/**
 * Applies a batch sequentially, in the order the client queued it.
 * Never parallel (A4) — ordering within a device is the whole point of
 * clientSeq, and Promise.all would discard it.
 */
export async function applyBatch(
  scope: Scoped,
  claims: SessionClaims,
  mutations: readonly Mutation[],
): Promise<MutationResult[]> {
  const ordered = [...mutations].sort((a, b) => a.clientSeq - b.clientSeq);
  const results: MutationResult[] = [];

  for (const mutation of ordered) {
    results.push(await applyMutation(scope, claims, mutation));
  }

  return results;
}
