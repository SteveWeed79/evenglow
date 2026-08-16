import { type Entity, type Op, partitionClears } from '@steading/contracts';
import { type LocalRecord, recordKey } from './records';

/**
 * How a mutation changes the local record it projects onto.
 *
 * Shared by enqueue and by hydration, deliberately. If the two built local
 * state differently, a device's own writes and the same writes arriving back
 * from the server would disagree, and the disagreement would only show up
 * after a reinstall — the hardest possible place to notice it.
 */

/**
 * The value a record holds after this mutation.
 *
 * **An update MERGES; it does not replace.** This is a correction, and the bug
 * it fixes stayed invisible until something in the app actually issued an
 * update: the projection wrote `value = payload` for every op, so editing a
 * group's head count replaced the whole record with `{ count: 12 }` and the
 * group lost its name, species and breed on the device that made the edit.
 * Every reader then skipped the row as unparseable — which looks, to the
 * person who just edited it, exactly like the app deleting their animals.
 *
 * The server has always merged: `apply.ts` uses `$set`, which replaces the
 * named top-level fields and leaves the rest. Shallow is the right depth for
 * the same reason — `$set: { withdrawalDays: {…} }` replaces that subdocument
 * whole rather than merging into it, so a treatment edited to drop its milk
 * withdrawal actually drops it.
 *
 * A delete keeps the value it had. The server archives rather than deleting
 * (P13) and the delete payload is only a reason string; overwriting a flock
 * with `{ reason: '…' }` would throw away the record the archive exists to
 * preserve.
 *
 * **A `null` removes the key rather than storing a null**, which is the client
 * half of `contracts/clearing.ts` and the reason the merge is not a plain
 * spread. Storing the null would be nearly right and wrong where it counts: a
 * reader parses this value against the entity's create schema, where an
 * optional field accepts a value or nothing and never a null, so a record
 * carrying one is dropped from every list on the device that just edited it.
 * Removing the key leaves exactly the record a farm that had never filled the
 * field in would have, which is what "cleared" means.
 */
export function nextRecordValue(op: Op, previous: unknown, payload: unknown): unknown {
  if (op === 'delete') return previous ?? payload;
  if (op !== 'update') return payload;

  if (!isPlainObject(payload)) return payload;

  const { set, clear } = partitionClears(payload);

  // Nothing to merge into: an update that reached a device before its create
  // did. Keeping the partial payload is what lets the create fill in the rest
  // when it arrives, and readers skip an incomplete record meanwhile. The
  // clears are dropped rather than stored, because there is nothing yet for
  // them to remove and a stored null outlives the moment it made sense in.
  if (!isPlainObject(previous)) return set;

  const merged: Record<string, unknown> = { ...previous, ...set };
  for (const key of clear) delete merged[key];

  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toLocalRecord(
  entity: Entity,
  targetId: string,
  op: Op,
  payload: unknown,
  updatedAt: number,
  previous?: unknown,
): LocalRecord {
  return {
    key: recordKey(entity, targetId),
    entity,
    targetId,
    value: nextRecordValue(op, previous, payload),
    updatedAt,
    deleted: op === 'delete',
  };
}
