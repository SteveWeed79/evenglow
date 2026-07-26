import type { z } from 'zod';
import { type Entity, isAppendOnly, type Op } from '../mutation';
import {
  eggLogCreateSchema,
  feedLogCreateSchema,
  flockCreateSchema,
  flockUpdateSchema,
  mortalityCreateSchema,
  predatorCreateSchema,
} from './birds';
import {
  equipmentCreateSchema,
  equipmentUpdateSchema,
  hourReadingCreateSchema,
  maintenanceCreateSchema,
  maintenanceUpdateSchema,
} from './iron';
import {
  deleteSchema,
  photoCreateSchema,
  photoUpdateSchema,
  taskCreateSchema,
  taskUpdateSchema,
} from './ops';

export * from './birds';
export * from './iron';
export * from './ops';

type PayloadKey = `${Entity}:${Op}`;

/**
 * The complete map of what may be sent for a given entity and op. An absent
 * key means the operation is not permitted at all — the server answers 400
 * rather than treating it as an empty update.
 *
 * Append-only entities (D3) appear with `:create` only. That is the whole
 * enforcement of "an update on an eggLog is a 400": there is no key to find.
 */
export const PAYLOAD_SCHEMAS: Partial<Record<PayloadKey, z.ZodType>> = {
  // Mutable entities
  'flock:create': flockCreateSchema,
  'flock:update': flockUpdateSchema,
  'flock:delete': deleteSchema,

  'equipment:create': equipmentCreateSchema,
  'equipment:update': equipmentUpdateSchema,
  'equipment:delete': deleteSchema,

  'maintenance:create': maintenanceCreateSchema,
  'maintenance:update': maintenanceUpdateSchema,
  'maintenance:delete': deleteSchema,

  'task:create': taskCreateSchema,
  'task:update': taskUpdateSchema,
  'task:delete': deleteSchema,

  'photo:create': photoCreateSchema,
  'photo:update': photoUpdateSchema,
  'photo:delete': deleteSchema,

  // Append-only entities — create only, by construction
  'eggLog:create': eggLogCreateSchema,
  'feedLog:create': feedLogCreateSchema,
  'mortality:create': mortalityCreateSchema,
  'predator:create': predatorCreateSchema,
  'hourReading:create': hourReadingCreateSchema,
};

/** Returns the schema for an entity+op pair, or undefined if the op is forbidden. */
export function payloadSchemaFor(entity: Entity, op: Op): z.ZodType | undefined {
  return PAYLOAD_SCHEMAS[`${entity}:${op}`];
}

/**
 * Guard used by both the client queue and the server applier, so a mutation
 * that would be rejected on flush cannot be enqueued in the first place.
 */
export function isOpAllowed(entity: Entity, op: Op): boolean {
  return payloadSchemaFor(entity, op) !== undefined;
}

/** Exported for tests: the invariant that append-only means create-only. */
export function appendOnlyOpsAreCreateOnly(entity: Entity): boolean {
  if (!isAppendOnly(entity)) return true;
  return isOpAllowed(entity, 'create') && !isOpAllowed(entity, 'update') && !isOpAllowed(entity, 'delete');
}
