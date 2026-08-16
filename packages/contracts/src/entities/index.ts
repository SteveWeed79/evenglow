import type { z } from 'zod';
import { type Entity, isAppendOnly, type Op } from '../mutation';
import {
  animalCreateSchema,
  animalUpdateSchema,
  eggLogCreateSchema,
  feedLogCreateSchema,
  flockCreateSchema,
  flockUpdateSchema,
  medicationCreateSchema,
  medicationUpdateSchema,
  namesOneSubject,
  mortalityCreateSchema,
  predatorCreateSchema,
  productionLogCreateSchema,
} from './livestock';
import {
  equipmentCreateSchema,
  equipmentUpdateSchema,
  hourReadingCreateSchema,
  hasATrigger,
  maintenanceCreateSchema,
  maintenanceUpdateSchema,
} from './iron';
import { careLogCreateSchema } from './care';
import { noteCreateSchema, noteUpdateSchema } from './notes';
import {
  breedingCreateSchema,
  breedingUpdateSchema,
  feedPlanCreateSchema,
  feedPlanUpdateSchema,
  incubationCreateSchema,
  incubationUpdateSchema,
  shearingCreateSchema,
  weightCreateSchema,
} from './breeding';
import {
  bedCreateSchema,
  bedUpdateSchema,
  harvestCreateSchema,
  plantingCreateSchema,
  plantingUpdateSchema,
  siteCreateSchema,
  siteUpdateSchema,
  varietyCreateSchema,
  varietyUpdateSchema,
} from './growing';
import {
  deleteSchema,
  inventoryCreateSchema,
  inventoryUpdateSchema,
  stockAdjustmentCreateSchema,
  photoCreateSchema,
  photoUpdateSchema,
  taskCreateSchema,
  taskUpdateSchema,
} from './ops';

export * from './livestock';
export * from './produces';
export * from './iron';
export * from './ops';
export * from './growing';
export * from './breeding';
export * from './care';
export * from './notes';

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

  'animal:create': animalCreateSchema,
  'animal:update': animalUpdateSchema,
  'animal:delete': deleteSchema,

  'medication:create': medicationCreateSchema,
  'medication:update': medicationUpdateSchema,
  'medication:delete': deleteSchema,

  'equipment:create': equipmentCreateSchema,
  'equipment:update': equipmentUpdateSchema,
  'equipment:delete': deleteSchema,

  'maintenance:create': maintenanceCreateSchema,
  'maintenance:update': maintenanceUpdateSchema,
  'maintenance:delete': deleteSchema,

  'task:create': taskCreateSchema,
  'task:update': taskUpdateSchema,
  'task:delete': deleteSchema,

  'stockAdjustment:create': stockAdjustmentCreateSchema,
  'stockAdjustment:delete': deleteSchema,
  'inventory:create': inventoryCreateSchema,
  'inventory:update': inventoryUpdateSchema,
  'inventory:delete': deleteSchema,

  'photo:create': photoCreateSchema,
  'photo:update': photoUpdateSchema,
  'photo:delete': deleteSchema,

  'site:create': siteCreateSchema,
  'site:update': siteUpdateSchema,
  'site:delete': deleteSchema,

  'bed:create': bedCreateSchema,
  'bed:update': bedUpdateSchema,
  'bed:delete': deleteSchema,

  'variety:create': varietyCreateSchema,
  'variety:update': varietyUpdateSchema,
  'variety:delete': deleteSchema,

  'planting:create': plantingCreateSchema,
  'planting:update': plantingUpdateSchema,
  'planting:delete': deleteSchema,

  'breeding:create': breedingCreateSchema,
  'breeding:update': breedingUpdateSchema,
  'breeding:delete': deleteSchema,

  'incubation:create': incubationCreateSchema,
  'incubation:update': incubationUpdateSchema,
  'incubation:delete': deleteSchema,

  'feedPlan:create': feedPlanCreateSchema,
  'feedPlan:update': feedPlanUpdateSchema,
  'feedPlan:delete': deleteSchema,

  /**
   * A note is a message rather than a measurement, so it can be taken back.
   * Only the body is editable — see `notes.ts`.
   */
  'note:create': noteCreateSchema,
  'note:update': noteUpdateSchema,
  'note:delete': deleteSchema,

  /**
   * Append-only entities: written once, never edited, removable in whole.
   *
   * **There is no `:update` on any of them and there never will be.** That is
   * what append-only means and what D3's load-bearing half rests on: an
   * observation's value cannot change, so two devices cannot disagree about
   * it and sync stays insert-if-absent.
   *
   * `:delete` is different and was wrong to refuse. An archive is
   * `$set archivedAt` — repeatable, so it cannot conflict either — and the
   * only thing it cost was D3's third reason, a "free audit history" nobody
   * asked for. A farm that logs twelve eggs against the wrong flock at 6am
   * needs to take it back, not to keep a record of having been mistaken.
   *
   * The hour meter is on this list like everything else. Why it was very
   * nearly not, and why exempting it would have been the worst place to do
   * so, is in `mutation.ts` beside `APPEND_ONLY_ENTITIES`.
   */
  'eggLog:create': eggLogCreateSchema,
  'eggLog:delete': deleteSchema,
  'productionLog:create': productionLogCreateSchema,
  'productionLog:delete': deleteSchema,
  'feedLog:create': feedLogCreateSchema,
  'feedLog:delete': deleteSchema,
  'mortality:create': mortalityCreateSchema,
  'mortality:delete': deleteSchema,
  'predator:create': predatorCreateSchema,
  'predator:delete': deleteSchema,
  'hourReading:create': hourReadingCreateSchema,
  'hourReading:delete': deleteSchema,
  'harvest:create': harvestCreateSchema,
  'harvest:delete': deleteSchema,
  'weight:create': weightCreateSchema,
  'weight:delete': deleteSchema,
  'shearing:create': shearingCreateSchema,
  'shearing:delete': deleteSchema,
  'careLog:create': careLogCreateSchema,
  'careLog:delete': deleteSchema,
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

/**
 * The half of a create-time invariant that a `.partial()` update cannot carry.
 *
 * **A create schema's `.refine()` is silently dropped by `.partial()`, and the
 * update schemas are all `z.object(shape).partial().strict()`.** So an
 * invariant enforced on the way in — exactly one subject on a treatment, at
 * least one trigger on a schedule — is enforced on create and on nothing else.
 * The field-level rules survive; the ones that read two fields together do not,
 * because half the fields are absent by design in a partial.
 *
 * It cannot be expressed on the update schema either, and that is why this is a
 * separate function rather than a fixed refine: the invariant is a property of
 * the RESULTING document, and a partial payload is only half of it. So the
 * applier merges the update onto the stored record and asks here.
 *
 * The predicates are the same ones the create schemas refine on, imported
 * rather than restated — a second copy would be a second chance to disagree,
 * and the two are meant to say the same thing for ever.
 *
 * `null` counts as absent throughout, and now for a reason that is true: it is
 * the wire's word for a cleared field (`../clearing.ts`). The merge handed in
 * here is `{ ...stored, ...payload }`, which means a field being cleared in
 * this very update reads as `null` rather than as gone — so an invariant that
 * treated null as a value would let a clear through that leaves the record
 * invalid. The sentence this replaces claimed the null came from the Mongo
 * driver storing an `undefined`, which never once happened: `JSON.stringify`
 * dropped the key first, and that lost clear is the defect this contract
 * change exists to fix.
 */
interface MergedInvariant {
  holds: (merged: Record<string, unknown>) => boolean;
  message: string;
}

const MERGED_INVARIANTS: Partial<Record<Entity, MergedInvariant>> = {
  medication: {
    holds: namesOneSubject,
    message: 'A treatment needs exactly one of a group or an animal.',
  },
  maintenance: {
    holds: hasATrigger,
    message: 'A schedule needs an hour interval, a day interval, or both.',
  },
};

/** The reason an updated document would be invalid, or null when it is fine. */
export function mergedUpdateProblem(entity: Entity, merged: Record<string, unknown>): string | null {
  const invariant = MERGED_INVARIANTS[entity];
  if (invariant === undefined) return null;
  return invariant.holds(merged) ? null : invariant.message;
}

/**
 * Whether an entity carries one of these at all.
 *
 * Exported for the test that keeps the table honest: every mutable entity whose
 * create schema is refined MUST appear above, or the next one added inherits
 * this bug in silence. That test is the actual fix — the two entries are only
 * the two instances that existed when it was written.
 */
export function hasMergedInvariant(entity: Entity): boolean {
  return MERGED_INVARIANTS[entity] !== undefined;
}

/**
 * Exported for tests: append-only means **never edited**, which is the half of
 * D3 that is load-bearing.
 *
 * It used to mean create-only, delete included. Removing a record turned out
 * to cost none of what D3 protects — an archive is repeatable, so it cannot
 * conflict and sync stays insert-if-absent — and the audit trail it protected
 * instead was one nobody wanted for an egg tally.
 *
 * So `update` stays forbidden on every one of them, and `delete` is allowed on
 * all of them.
 */
export function appendOnlyIsNeverEdited(entity: Entity): boolean {
  if (!isAppendOnly(entity)) return true;
  return isOpAllowed(entity, 'create') && isOpAllowed(entity, 'delete') && !isOpAllowed(entity, 'update');
}
