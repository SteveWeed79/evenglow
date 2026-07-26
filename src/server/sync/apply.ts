import { MongoServerError } from 'mongodb';
import { payloadSchemaFor } from '@/lib/contracts/entities';
import {
  MUTATION_SCHEMA_VERSION,
  type Mutation,
  type MutationResult,
} from '@/lib/contracts/mutation';
import { canMutate } from '@/lib/contracts/roles';
import type { SessionClaims } from '@/server/auth/session';
import type { Scoped, Tenanted } from '@/server/db/scoped';

/**
 * Per-mutation applier.
 *
 * Phase 1 records the mutation log idempotently and authorizes every entry.
 * Projecting mutations into their domain collections is Phase 3 work; the
 * log is the source of truth either way, so that projection is a rebuild,
 * not a migration.
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

  try {
    // Idempotency (A3): $setOnInsert means a replayed batch writes nothing the
    // second time, and upsertedCount is what distinguishes the two cases.
    const res = await scope
      .col<MutationDoc>('mutations')
      .upsertOne({ _id: id }, { $setOnInsert: doc });
    return res.upsertedCount ? { id, status: 'applied' } : { id, status: 'duplicate' };
  } catch (error) {
    // _id is unique collection-wide, so a mutation id already used by another
    // tenant fails the insert rather than matching the org-guarded filter.
    // Surfacing it as 'duplicate' would tell the caller a foreign id exists.
    if (error instanceof MongoServerError && error.code === 11000) {
      return rejected(id, 'That record id is already in use. The app will mint a new one.');
    }
    throw error;
  }
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
