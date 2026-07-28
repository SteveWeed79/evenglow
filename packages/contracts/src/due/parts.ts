import { DEFAULT_NOTICE_DAYS } from './notice';
import { type Due, dueDate } from './types';

/**
 * Is the part on the shelf?
 *
 * The schemas already carried the link — `maintenance.partIds` names what a
 * service consumes and `inventory.equipmentId` ties a part to its machine.
 * What was missing was the question, and the question is the whole feature:
 * a service due in two weeks is only actionable if the filter is in the barn.
 *
 * ## Why this is a separate row and not a flag on the service
 *
 * Because they resolve differently and at different times. "Order the filter"
 * is done by ordering; "change the filter" is done by changing it. Folding
 * them into one row would mean a service that stayed amber because a part was
 * missing, and no way to tell — at a glance, in a barn — whether the job was
 * waiting on a person or on the post.
 */

export interface PartStock {
  id: string;
  name: string;
  quantity: number;
  /** How many this service consumes. Defaults to one. */
  needed?: number | undefined;
}

export const PART_STATES = ['stocked', 'short', 'unknown'] as const;
export type PartState = (typeof PART_STATES)[number];

/**
 * Whether the shelf can cover this service.
 *
 * `unknown` when the service names no parts, which is the common case and
 * must not read as a problem. A farm that has not linked its filters is not a
 * farm that is short of filters.
 */
export function partsState(parts: readonly PartStock[]): PartState {
  if (parts.length === 0) return 'unknown';
  return parts.every((p) => p.quantity >= (p.needed ?? 1)) ? 'stocked' : 'short';
}

/**
 * A row saying to order what is missing, dated so it arrives in time.
 *
 * **Dated earlier than the service itself**, by the notice the service already
 * carries — a part ordered the day a service falls due is a part that arrives
 * after it. That is the arithmetic the whole feature exists for: the service
 * is the deadline, the order is the lead time before it.
 *
 * Returns null when there is nothing to order, when the service has no date to
 * count back from, or when the service names no parts. A row nothing can clear
 * is worse than no row.
 */
export function partsDue(
  service: Due,
  parts: readonly PartStock[],
  leadDays = DEFAULT_NOTICE_DAYS.service,
): Due | null {
  if (partsState(parts) !== 'short') return null;

  const at = dueDate(service);
  if (at === null) return null;

  const short = parts.filter((p) => p.quantity < (p.needed ?? 1));
  const names = short.map((p) => p.name).join(', ');

  const DAY_MS = 86_400_000;

  return {
    key: `${service.key}:parts`,
    kind: 'task',
    subject: service.subject,
    title: `Order ${names} for ${service.title.toLowerCase()}`,
    at: at - leadDays * DAY_MS,
    atReading: null,
    projectedAt: null,
    /**
     * A week, on top of the lead time already baked into the date.
     *
     * The date is when ordering becomes necessary; this is how long before
     * that it starts being mentioned. Ordering early costs nothing and
     * ordering late costs a machine standing idle in the one week it was
     * needed.
     */
    noticeDays: 7,
  };
}

/**
 * The sentence beside a service, when the parts are not in.
 *
 * Names what is missing rather than saying "parts short", because the answer
 * to "which?" is the only reason anyone reads it.
 */
export function partsNote(parts: readonly PartStock[]): string | null {
  const short = parts.filter((p) => p.quantity < (p.needed ?? 1));
  if (short.length === 0) return null;

  const missing = short
    .map((p) => {
      const needed = p.needed ?? 1;
      const gap = needed - p.quantity;
      return needed === 1 ? p.name : `${p.name} (${gap} more)`;
    })
    .join(', ');

  return `Not on the shelf: ${missing}.`;
}
