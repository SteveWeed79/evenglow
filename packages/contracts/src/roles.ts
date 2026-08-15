import { z } from 'zod';
import { type Entity, isAppendOnly, type Op } from './mutation';

/**
 * The role matrix. Shared client/server on purpose: the client uses it to hide
 * controls a user cannot use, the server uses it to enforce. The client copy
 * is UX only — it is never the control (D4, invariant 5).
 */

export const ROLES = ['owner', 'admin', 'hand'] as const;
export type Role = (typeof ROLES)[number];

/** For request bodies. `isRole` stays, for narrowing values already in hand. */
export const roleSchema = z.enum(ROLES);

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
 * Three deliberate exceptions, all required for a hand to work a morning:
 *  - completing a chore (`task:update`), since the Today list is the job
 *  - attaching a photo (`photo:create`), since observations carry evidence
 *  - leaving, fixing and removing a note (`note:*`)
 *
 * None lets them define new work, only discharge and document assigned work.
 *
 * **The note exception needs the second half of its rule elsewhere.** A hand
 * may change *a* note as far as this function is concerned, because role and
 * entity are all it is given — whether they may change *this* note depends on
 * who wrote it, which needs the document. `mayChangeNote` decides that, and
 * the applier checks it against the server's own `createdBy` stamp. Leaving
 * that out would let one hand delete another's notes.
 */
export function canMutate(role: Role, entity: Entity, op: Op): boolean {
  if (role === 'owner' || role === 'admin') return true;

  /**
   * A hand may take back what a hand may write.
   *
   * Append-only used to mean create-only for everyone below admin, which left
   * the person who mis-logged the tally unable to correct it and an owner
   * doing it for them at the end of the day, from a description. `update` is
   * still refused — that is what append-only means.
   */
  if (isAppendOnly(entity)) return op === 'create' || op === 'delete';
  if (entity === 'task' && op === 'update') return true;
  // The upload stamp is the other half of this — see isUploadStamp below.
  if (entity === 'photo' && op === 'create') return true;
  // Ownership is enforced by mayChangeNote at apply time — see above.
  if (entity === 'note') return true;

  return false;
}

/**
 * The one photo update a hand may make: recording that the bytes arrived.
 *
 * **A hand could take a photo and never get it off the handset.** `photo:create`
 * covers the metadata and `routes/photos.ts` already treats the first byte
 * upload as completing that create — but the client then enqueues a
 * `photo:update` stamping `uploadedAt`, and this matrix refused it. So the
 * record synced, the bytes uploaded, and the field that tells every OTHER
 * device the image exists was never set: `sync/photos.ts` only offers a photo
 * for download once `uploadedAt` is present. The photo was on the server and
 * invisible to the farm, and the hand collected a permanent inbox entry they
 * could do nothing about.
 *
 * Kept OUT of `canMutate` deliberately, because that function is also what
 * gates the byte PUT. Widening it to `photo:update` would let a hand REPLACE
 * the image on an established photo, which that route refuses on purpose — the
 * fix for an invisible photo must not become a way to overwrite somebody
 * else's. So the exception is expressed on the mutation instead, and combined
 * with the role failure at the one call site that should honour it
 * (`sync/apply.ts`).
 *
 * Narrow on purpose: exactly the one field, nothing beside it. The applier
 * completes the rule with the half that needs the document — a stamp may
 * finish an upload, not re-stamp one that is already finished — the same
 * division `mayChangeNote` uses.
 */
export function isUploadStamp(entity: Entity, op: Op, payload: unknown): boolean {
  if (entity !== 'photo' || op !== 'update') return false;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false;

  // Only the key set is read here; the value is validated by photoUpdateSchema
  // immediately afterwards, like every other payload (invariant 11).
  const keys = Object.keys(payload);
  return keys.length === 1 && keys[0] === 'uploadedAt';
}
