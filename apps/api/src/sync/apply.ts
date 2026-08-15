import { MongoServerError } from 'mongodb';
import {
  canMutate,
  entitySchema,
  opSchema,
  roleRefusal,
  MUTATION_SCHEMA_VERSION,
  payloadSchemaFor,
  type Entity,
  type Mutation,
  type MutationResult,
  type Op,
} from '@steading/contracts';
import type { SessionClaims } from '../auth/claims';
import type { Scoped, Tenanted } from '../db/scoped';
import { DECIDED_OUTCOMES, PENDING, type StoredOutcome } from './outcome';
import {
  decideProjection,
  ENTITY_COLLECTIONS,
  type ProjectionDecision,
} from './projections';

/**
 * Per-mutation applier.
 *
 * Three writes per mutation, in this order:
 *  1. the mutation log, idempotently, stamped `pending` — the source of truth,
 *     and the audit trail D3 gives us for free;
 *  2. the domain projection, which is a derived read model;
 *  3. the outcome, which turns the log row from "attempted" into a decided
 *     fact and is what the replication feed filters on.
 *
 * The order matters. If the process dies between 1 and 2 the log still holds
 * the mutation, so the projection can be rebuilt; the reverse would leave a
 * projected record with no record of what produced it.
 *
 * **`pending` is written with the envelope rather than after the decision, and
 * that is the whole design.** Writing the outcome only at step 3 would leave a
 * crashed row carrying NO outcome — which is ambiguous between "applied and
 * unstamped" and "refused and unstamped", and the feed needs opposite answers
 * for those two. `pending` says exactly one thing. It also repairs itself: the
 * client never got a response, so it resends, and the duplicate branch below
 * re-projects the stored envelope and stamps the outcome it should have had.
 *
 * **The projection is driven by the STORED envelope, never by a replayed
 * request.** `$setOnInsert` freezes the log row, so on a replay the request and
 * the log can disagree — through a payload migrated by an envelope-ladder bump,
 * or through a client reusing an id on purpose. Projecting the request would
 * write domain state the audit row does not describe. Reading it back costs one
 * findOne on the duplicate path only.
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
  /** What the applier decided. See outcome.ts. */
  outcome: StoredOutcome;
  /** The user-facing reason, carried for `conflict` and `rejected` only. */
  outcomeReason?: string;
}

/**
 * One command to project, from the request on a first attempt or replayed out
 * of the log on a duplicate.
 *
 * It exists so `project()` cannot accidentally read the request: everything it
 * needs to choose a collection, a document and an attribution comes from here,
 * and on the duplicate path every field of it came off disk.
 */
interface Command {
  entity: Entity;
  op: Op;
  targetId: string;
  deviceId: string;
  /** Who issued it. Attribution only — authorization is re-derived per attempt. */
  userId: string;
  payload: object;
}

/** A projected domain record. Fields beyond these are entity-specific. */
interface ProjectedDoc extends Tenanted {
  archivedAt?: Date | null;
  createdAt?: Date;
  /** Stable across edits, unlike `updatedBy`. See the insert branch. */
  createdBy?: string;
  updatedAt?: Date;
  updatedBy?: string;
  updatedByDevice?: string;
}

function rejected(id: string, reason: string): MutationResult {
  return { id, status: 'rejected', reason };
}

async function applyMutation(
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
    return rejected(id, roleRefusal(op, entity));
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
    outcome: PENDING,
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

  /**
   * A first attempt inserted the row we just built, so the request and the
   * stored envelope are the same thing and there is nothing to read back.
   */
  let command: Command = {
    entity,
    op,
    targetId: mutation.targetId,
    deviceId: mutation.deviceId,
    userId: claims.userId,
    payload,
  };

  if (!firstTime) {
    const replay = await replayFromLog(scope, id);

    // Already decided. Returning the stored answer is what makes a replay free
    // of side effects — and it is the only thing that keeps the caller's inbox
    // agreeing with the log about a refusal it has already been told about.
    if (replay.kind === 'decided') return replay.result;

    /**
     * The row exists but this build cannot read it back — a payload written by
     * a newer schema, or a corrupt document.
     *
     * Reported as `duplicate` and not projected. A row we cannot parse is a row
     * we cannot safely replay, and guessing at it is how a bad envelope becomes
     * bad domain state.
     */
    if (replay.kind === 'unreadable') return { id, status: 'duplicate' };

    command = replay.command;
  }

  const projection = await project(scope, claims, command);
  await stampOutcome(scope, id, projection);

  if (projection.kind === 'conflict') {
    return { id, status: 'conflict', reason: projection.reason };
  }
  if (projection.kind === 'rejected') {
    return rejected(id, projection.reason);
  }

  return { id, status: firstTime ? 'applied' : 'duplicate' };
}

type Replay =
  /** Logged but undecided: re-project it, from the log rather than the request. */
  | { kind: 'replay'; command: Command }
  /** Decided already. The stored answer is the answer. */
  | { kind: 'decided'; result: MutationResult }
  | { kind: 'unreadable' };

/**
 * Reads a duplicate's stored envelope back and says what to do with it.
 *
 * Every field is re-validated rather than trusted (invariant 11). The document
 * is typed, but the type describes what this build writes, not what is on disk:
 * an older deploy, a newer one, or a hand-edited row are all possible, and the
 * cast that would paper over them is the thing the invariant exists to ban.
 */
async function replayFromLog(scope: Scoped, id: string): Promise<Replay> {
  const stored = await scope.col<MutationDoc>('mutations').findOne({ _id: id });

  // Gone between the upsert and this read. Not reachable through any code path
  // we have, so it is a corrupt-state case rather than an ordinary one.
  if (!stored) return { kind: 'unreadable' };

  /**
   * A missing outcome counts as undecided, which is what backfills the field
   * without a migration: rows written before it existed re-project once, on
   * their next replay, and are stamped from then on. Their projection ran when
   * they were first applied — re-running it is exactly what this code did
   * unconditionally before, so it is not new behaviour for them.
   *
   * Read through `unknown` because this is what is on disk, not what this build
   * writes. Anything that is not absent, null, or `pending` is a decision —
   * including one from a newer deploy this build cannot name, which is left
   * alone rather than re-decided by an older applier.
   */
  const outcome: unknown = stored.outcome;
  const undecided = outcome === undefined || outcome === null || outcome === PENDING;
  if (!undecided) return { kind: 'decided', result: decidedResult(id, stored) };

  const entity = entitySchema.safeParse(stored.entity);
  const op = opSchema.safeParse(stored.op);
  if (!entity.success || !op.success) return { kind: 'unreadable' };

  const schema = payloadSchemaFor(entity.data, op.data);
  if (!schema) return { kind: 'unreadable' };

  const parsed = schema.safeParse(stored.payload);
  if (!parsed.success) return { kind: 'unreadable' };

  const payload: unknown = parsed.data;
  if (typeof payload !== 'object' || payload === null) return { kind: 'unreadable' };

  if (
    typeof stored.targetId !== 'string' ||
    typeof stored.deviceId !== 'string' ||
    typeof stored.userId !== 'string'
  ) {
    return { kind: 'unreadable' };
  }

  return {
    kind: 'replay',
    command: {
      entity: entity.data,
      op: op.data,
      targetId: stored.targetId,
      deviceId: stored.deviceId,
      userId: stored.userId,
      payload,
    },
  };
}

/**
 * The answer a decided row gives on every later replay.
 *
 * A refusal stays a refusal. Reporting `duplicate` instead would tell the
 * device its rejected-inbox entry had somehow been accepted on retry, which is
 * the opposite of true.
 */
function decidedResult(id: string, stored: MutationDoc): MutationResult {
  if (stored.outcome === 'conflict') {
    return {
      id,
      status: 'conflict',
      reason: stored.outcomeReason ?? 'That record changed on another device.',
    };
  }
  if (stored.outcome === 'rejected') {
    return rejected(id, stored.outcomeReason ?? 'The server refused that record.');
  }
  return { id, status: 'duplicate' };
}

/**
 * Turns the log row from "attempted" into a decided fact.
 *
 * The filter carries the undecided state, so a second caller racing the same
 * replay cannot overwrite a terminal outcome — and `null` matches a document
 * whose field is absent, which is how a pre-outcome row gets stamped the first
 * time it is replayed.
 */
async function stampOutcome(
  scope: Scoped,
  id: string,
  decision: ProjectionDecision,
): Promise<void> {
  const reason = 'reason' in decision ? decision.reason : undefined;

  await scope.col<MutationDoc>('mutations').updateOne(
    { _id: id, outcome: { $nin: DECIDED_OUTCOMES } },
    { $set: { outcome: decision.kind, ...(reason === undefined ? {} : { outcomeReason: reason }) } },
  );
}

/** Writes the derived read model for one command. */
async function project(
  scope: Scoped,
  claims: SessionClaims,
  command: Command,
): Promise<ProjectionDecision> {
  const { entity, op, targetId, payload } = command;
  const collection = ENTITY_COLLECTIONS[entity];
  const col = scope.col<ProjectedDoc>(collection);

  const existing = await col.findOne({ _id: targetId });

  const decision = decideProjection(entity, op, payload, {
    existing,
    /**
     * Authorization comes from the token presented NOW, never from the log
     * (invariant 8). A replay is a fresh attempt by whoever is holding the
     * session, and a role revoked since the command was queued must still bite.
     */
    actor: { userId: claims.userId, role: claims.role },
    ...(entity === 'hourReading' ? { lastHours: await highestHours(scope, payload) } : {}),
  });

  /**
   * Attribution comes from the command, which names who ISSUED it.
   *
   * On a first attempt that is the caller, so this is unchanged. On a replay it
   * is the device that queued the work rather than whoever happened to retry —
   * a record should not change hands because a flush was resent.
   */
  const stamp = {
    updatedAt: new Date(),
    updatedBy: command.userId,
    updatedByDevice: command.deviceId,
  };

  switch (decision.kind) {
    case 'insert':
      await col.upsertOne(
        { _id: targetId },
        {
          $setOnInsert: {
            ...payload,
            ...stamp,
            createdAt: new Date(),
            /**
             * Who made it, and it does not move.
             *
             * `updatedBy` is overwritten by whoever edited last, so it cannot
             * answer "is this yours" after a single edit. Notes need a stable
             * answer to that, and every other entity is better off having one
             * too.
             */
            createdBy: command.userId,
          },
        },
      );
      break;

    case 'update':
      await col.updateOne({ _id: targetId }, { $set: { ...payload, ...stamp } });
      break;

    case 'archive':
      // Archive, never delete — history survives (P13).
      await col.updateOne({ _id: targetId }, { $set: { archivedAt: new Date(), ...stamp } });
      break;

    case 'noop':
    case 'conflict':
    case 'rejected':
      break;
  }

  return decision;
}

/**
 * The highest hours already recorded for the machine a reading belongs to.
 *
 * **Archived readings do not count, and that is the whole escape hatch.** The
 * meter rule refuses anything below this number, so a fat-fingered 9999 would
 * otherwise lock the machine out of its own log forever — the correction is
 * below the mistake by definition. Taking the bad reading back has to lower
 * this, or removing it would achieve nothing.
 *
 * `archivedAt: null` matches both an explicit null and a document that has
 * never carried the field, which is every reading that was never removed.
 */
async function highestHours(scope: Scoped, payload: object): Promise<number | null> {
  const equipmentId = (payload as { equipmentId?: unknown }).equipmentId;
  if (typeof equipmentId !== 'string') return null;

  // One indexed read rather than pulling the series and reducing it — the
  // orgId+equipmentId+hours index makes this a single seek.
  const [highest] = await scope
    .col<ProjectedDoc & { equipmentId: string; hours: number }>('hourReadings')
    .findMany({ equipmentId, archivedAt: null }, { limit: 1, sort: { hours: -1 } });

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
