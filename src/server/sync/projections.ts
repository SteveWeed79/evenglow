import type { CollectionName } from '@/server/db/scoped';
import { type Entity, isAppendOnly, type Op } from '@/lib/contracts/mutation';

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
};

/**
 * The shape apply.ts reads back before deciding. Deliberately minimal: a
 * decision must not depend on entity-specific fields it has not been given.
 */
export interface ExistingDoc {
  _id: string;
  archivedAt?: Date | null;
}

export interface ProjectionContext {
  /** The current document at targetId, if any. */
  existing: ExistingDoc | null;
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
  return decideMutable(op, context);
}

function decideAppendOnly(
  entity: Entity,
  op: Op,
  payload: unknown,
  context: ProjectionContext,
): ProjectionDecision {
  // The contract layer has no schema for update/delete on these, so reaching
  // here with one means a caller bypassed it.
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
