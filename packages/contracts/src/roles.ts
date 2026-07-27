import { type Entity, isAppendOnly, type Op } from './mutation';

/**
 * The role matrix. Shared client/server on purpose: the client uses it to hide
 * controls a user cannot use, the server uses it to enforce. The client copy
 * is UX only — it is never the control (D4, invariant 5).
 */

export const ROLES = ['owner', 'admin', 'hand'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Farm Hand can record what happened; they cannot change what things are.
 *
 * Concretely: every append-only observation (eggs, feed, mortality, predator
 * sightings, hour readings) is writable, because that is the main reason a
 * second user exists. Flocks, equipment, and maintenance schedules are
 * read-only to them.
 *
 * Two deliberate exceptions, both required for a hand to work a morning:
 *  - completing a chore (`task:update`), since the Today list is the job
 *  - attaching a photo (`photo:create`), since observations carry evidence
 * Neither lets them define new work, only discharge and document assigned work.
 */
export function canMutate(role: Role, entity: Entity, op: Op): boolean {
  if (role === 'owner' || role === 'admin') return true;

  if (isAppendOnly(entity)) return op === 'create';
  if (entity === 'task' && op === 'update') return true;
  if (entity === 'photo' && op === 'create') return true;

  return false;
}
