import type { Entity, Op } from '@steading/contracts';
import { type LocalRecord, recordKey } from './schema';

/**
 * Turns a mutation into its local record.
 *
 * Shared by enqueue and by hydration, deliberately. If the two built local
 * state differently, a device's own writes and the same writes arriving back
 * from the server would disagree, and the disagreement would only show up
 * after a reinstall — the hardest possible place to notice it.
 */
export function toLocalRecord(
  entity: Entity,
  targetId: string,
  op: Op,
  payload: unknown,
  updatedAt: number,
): LocalRecord {
  return {
    key: recordKey(entity, targetId),
    entity,
    targetId,
    value: payload,
    updatedAt,
    deleted: op === 'delete',
  };
}
