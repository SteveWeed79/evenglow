import type { CollectionName } from '../db/scoped';
import { type Entity, isAppendOnly, mayChangeNote, type Op, type Role } from '@steading/contracts';

/**
 * Projection decisions, as pure functions.
 *
 * The interesting rules — what counts as a duplicate, what counts as a
 * conflict, when an hour reading is impossible — are decided here from plain
 * inputs, so they are testable without a live server. apply.ts does the
 * fetching and writing and nothing else.
 */

export const ENTITY_COLLECTIONS: Record<Entity, CollectionName> = {
  flock: 'flocks',
  animal: 'animals',
  medication: 'medications',
  eggLog: 'eggLogs',
  productionLog: 'productionLogs',
  feedLog: 'feedLogs',
  mortality: 'mortality',
  predator: 'predatorLogs',
  equipment: 'equipment',
  hourReading: 'hourReadings',
  maintenance: 'maintenance',
  task: 'tasks',
  inventory: 'inventory',
  photo: 'photos',
  site: 'sites',
  bed: 'beds',
  variety: 'varieties',
  planting: 'plantings',
  harvest: 'harvests',
  breeding: 'breedings',
  incubation: 'incubations',
  weight: 'weights',
  shearing: 'shearings',
  feedPlan: 'feedPlans',
  careLog: 'careLogs',
  note: 'notes',
};

/**
 * The shape apply.ts reads back before deciding. Deliberately minimal: a
 * decision must not depend on entity-specific fields it has not been given.
 */
export interface ExistingDoc {
  _id: string;
  archivedAt?: Date | null;
  /**
   * Who created it, stamped from the verified token at insert.
   *
   * Only consulted for notes, and never taken from a payload — a client that
   * could name its own author could edit anyone's note by claiming to be them.
   */
  createdBy?: string;
}

export interface ProjectionContext {
  /** The current document at targetId, if any. */
  existing: ExistingDoc | null;
  /** Who is asking, re-derived from the token. Consulted for notes. */
  actor?: { userId: string; role: Role };
  /**
   * Highest hours already recorded for the machine this reading belongs to.
   * Only consulted for hourReading.
   */
  lastHours?: number | null;
}

export type ProjectionDecision =
  | { kind: 'insert' }
  | { kind: 'update' }
  | { kind: 'archive' }
  /** Already in the desired state — idempotent replay, not an error. */
  | { kind: 'noop' }
  | { kind: 'conflict'; reason: string }
  | { kind: 'rejected'; reason: string };

/**
 * Records are archived, never deleted (P13). A flock's history is the point
 * of keeping it, and a deleted bird takes its laying record with it.
 */
export function decideProjection(
  entity: Entity,
  op: Op,
  payload: unknown,
  context: ProjectionContext,
): ProjectionDecision {
  if (isAppendOnly(entity)) {
    return decideAppendOnly(entity, op, payload, context);
  }
  if (entity === 'note') {
    return decideNote(op, context);
  }
  return decideMutable(op, context);
}

/**
 * A note, with the half of its rule that `canMutate` could not express.
 *
 * `canMutate` sees a role and an entity, so it can only answer "may a hand
 * change notes at all". Whether they may change *this* note depends on who
 * wrote it, and that is a fact about the document — so it is decided here,
 * against the server's own `createdBy` stamp rather than anything the client
 * sent.
 *
 * Refused rather than conflicted: a hand editing somebody else's note is not
 * two people racing, it is one person doing something they are not allowed to
 * do, and it must land in their rejected inbox saying so.
 */
function decideNote(op: Op, context: ProjectionContext): ProjectionDecision {
  const { existing, actor } = context;

  if (op !== 'create' && existing && actor) {
    if (!mayChangeNote(actor.role, actor.userId, existing.createdBy)) {
      return {
        kind: 'rejected',
        reason: 'That note was left by someone else. Only they, or the farm owner, can change it.',
      };
    }
  }

  return decideMutable(op, context);
}

function decideAppendOnly(
  entity: Entity,
  op: Op,
  payload: unknown,
  context: ProjectionContext,
): ProjectionDecision {
  /**
   * Editing is still refused, and always will be — that is what append-only
   * means, and it is what D3's load-bearing half rests on. Removing is not.
   *
   * The archive is `$set archivedAt`, which is repeatable, so it cannot
   * conflict and sync stays insert-if-absent, exactly as a create does.
   */
  if (op === 'delete') {
    // Already gone, or never here. Either way the intent is satisfied, and a
    // replay must not be an error.
    if (!context.existing || context.existing.archivedAt) return { kind: 'noop' };
    return { kind: 'archive' };
  }

  if (op !== 'create') {
    return { kind: 'rejected', reason: `A ${entity} cannot be changed once recorded.` };
  }

  // Insert-if-absent. An immutable observation cannot conflict (D3).
  if (context.existing) return { kind: 'noop' };

  if (entity === 'hourReading') {
    return decideHourReading(payload, context.lastHours ?? null);
  }

  return { kind: 'insert' };
}

/**
 * An hour meter only counts up. A reading below the last recorded value is
 * a mistyped digit or the wrong machine, and accepting it would corrupt every
 * maintenance forecast derived from the series.
 *
 * **This rule is why an hour reading has to be removable.** It refuses the
 * correction as readily as it refuses the mistake: type 9999 onto a tractor
 * that has done 999 and every true reading afterwards is below the highest, so
 * the machine can never be logged again. Taking the bad reading back is the
 * only way out, and `highestHours` skips archived rows so that it works.
 */
export function decideHourReading(payload: unknown, lastHours: number | null): ProjectionDecision {
  if (lastHours === null) return { kind: 'insert' };

  const hours = (payload as { hours?: unknown }).hours;
  if (typeof hours !== 'number') {
    return { kind: 'rejected', reason: 'That hour reading is missing a value.' };
  }

  if (hours < lastHours) {
    // Plain, specific, and actionable — it names the number to check against.
    return {
      kind: 'rejected',
      reason: `That hour reading is below the last one recorded (${lastHours} h). Check the meter and try again.`,
    };
  }

  return { kind: 'insert' };
}

function decideMutable(op: Op, context: ProjectionContext): ProjectionDecision {
  const { existing } = context;

  switch (op) {
    case 'create':
      // Same ULID arriving twice is a replay, not a second record (D1).
      return existing ? { kind: 'noop' } : { kind: 'insert' };

    case 'update':
      if (!existing) {
        // Never upsert an update: the record may have been archived on
        // another device, and silently recreating it would resurrect
        // something a user deliberately retired (A5).
        return {
          kind: 'conflict',
          reason: 'That record no longer exists. It may have been removed on another device.',
        };
      }
      if (existing.archivedAt) {
        return {
          kind: 'conflict',
          reason: 'That record was archived on another device. Restore it before editing.',
        };
      }
      return { kind: 'update' };

    case 'delete':
      // Already archived, or never existed — either way the caller's intent
      // is satisfied, so a replay is not an error.
      if (!existing || existing.archivedAt) return { kind: 'noop' };
      return { kind: 'archive' };
  }
}
