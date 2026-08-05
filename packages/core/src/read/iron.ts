import { z } from 'zod';
import {
  equipmentCreateSchema,
  inventoryCreateSchema,
  maintenanceCreateSchema,
  type Species,
} from '@steading/contracts';
import { localStore } from '../db/store';

/**
 * Local-first reads for equipment.
 *
 * W3 is one app for birds and iron. The morning list is "feed birds, check
 * waterer, grease loader" — it does not sort itself by module, so iron reads
 * exactly the same way stock does, from the same local projection.
 */

export interface Machine {
  id: string;
  name: string;
  make?: string;
  model?: string;
  hasHourMeter: boolean;
  /** Highest reading recorded on this device. */
  hours: number | null;
  /** Hours per day, from the recorded series. Null until there are two readings. */
  usagePerDay: number | null;
}

const storedEquipment = equipmentCreateSchema.partial({ hasHourMeter: true });

const storedReading = z.object({
  occurredAt: z.number().int(),
  equipmentId: z.string(),
  hours: z.number(),
});

interface Reading {
  occurredAt: number;
  hours: number;
}

/**
 * Usage rate from the recorded series (W5).
 *
 * Everyone else alerts when you cross 250 hours. The number worth having is
 * "due in about nine days at 1.4 h/day", because that is the one that lets a
 * filter be ordered before it matters.
 *
 * Uses the first and last reading rather than adjacent pairs: a machine idle
 * for a fortnight and then run hard for a day should read as its average, not
 * as the last day's burst.
 */
export function usagePerDay(readings: readonly Reading[]): number | null {
  if (readings.length < 2) return null;

  const sorted = [...readings].sort((a, b) => a.occurredAt - b.occurredAt);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  const days = (last.occurredAt - first.occurredAt) / 86_400_000;
  if (days <= 0) return null;

  const hours = last.hours - first.hours;
  if (hours < 0) return null;

  return hours / days;
}

/** Days until an hour-based service is due, at the current rate. */
export function daysUntilDue(
  currentHours: number,
  dueAtHours: number,
  perDay: number | null,
): number | null {
  if (perDay === null || perDay <= 0) return null;
  return Math.max(0, (dueAtHours - currentHours) / perDay);
}

export async function listMachines(): Promise<Machine[]> {
  const [equipment, readings] = await Promise.all([
    localStore().readRecordsByEntity('equipment'),
    localStore().readRecordsByEntity('hourReading'),
  ]);

  const byMachine = new Map<string, Reading[]>();
  for (const record of readings) {
    if (record.deleted) continue;
    const parsed = storedReading.safeParse(record.value);
    if (!parsed.success) continue;

    const list = byMachine.get(parsed.data.equipmentId) ?? [];
    list.push({ occurredAt: parsed.data.occurredAt, hours: parsed.data.hours });
    byMachine.set(parsed.data.equipmentId, list);
  }

  return equipment
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = storedEquipment.safeParse(record.value);
      if (!parsed.success) return [];

      const series = byMachine.get(record.targetId) ?? [];
      const hours = series.length > 0 ? Math.max(...series.map((r) => r.hours)) : null;

      return [
        {
          id: record.targetId,
          name: parsed.data.name,
          ...(parsed.data.make === undefined ? {} : { make: parsed.data.make }),
          ...(parsed.data.model === undefined ? {} : { model: parsed.data.model }),
          hasHourMeter: parsed.data.hasHourMeter ?? true,
          hours,
          usagePerDay: usagePerDay(series),
        } satisfies Machine,
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── service schedules ────────────────────────────────────────────────────────

/**
 * A maintenance interval on a machine.
 *
 * Dual-trigger by design: hours OR days, whichever comes round first. A
 * machine with an hour meter is serviced on hours and one without is serviced
 * on dates, and `serviceDue` refuses to build a row it cannot evaluate — an
 * hours interval on a meterless pump produces nothing rather than a row that
 * sits on Today forever.
 */
export interface Service {
  id: string;
  equipmentId: string;
  title: string;
  intervalHours?: number;
  intervalDays?: number;
  lastDoneAtHours?: number;
  lastDoneAtDate?: number;
  partIds?: string[];
  /** P15 — what to look at while doing it, in the order the machine is walked. */
  checks?: string[];
  note?: string;
}

const storedMaintenance = z.object(maintenanceCreateSchema.shape).partial();

export async function listServices(): Promise<Service[]> {
  const records = await localStore().readRecordsByEntity('maintenance');

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = storedMaintenance.safeParse(record.value);
      if (!parsed.success || parsed.data.equipmentId === undefined || parsed.data.title === undefined) {
        return [];
      }

      const { equipmentId, title, partIds, checks, ...rest } = parsed.data;
      return [
        {
          id: record.targetId,
          equipmentId,
          title,
          ...(partIds === undefined ? {} : { partIds: [...partIds] }),
          ...(checks === undefined ? {} : { checks: [...checks] }),
          ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
        } satisfies Service,
      ];
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

// ── the shelf ────────────────────────────────────────────────────────────────

/**
 * Feed, bedding, medicine and parts.
 *
 * `equipmentId` is what turns a list of filters into the answer to "can this
 * service actually be done" — `partsDue` reads it, and a service due in a
 * fortnight is only actionable if the filter is in the barn.
 */
export interface StockItem {
  id: string;
  name: string;
  kind: string;
  unit: string;
  quantity: number;
  reorderBelow?: number;
  /** What this sack's scoop holds, in grams, when the farm has said. */
  scoopGrams?: number;
  /** What one `unit` costs, in minor units. Absent means never told. */
  costCents?: number;
  equipmentId?: string;
  supplier?: string;
  note?: string;
  /** Who it is for. Absent means nobody said — see `inventoryShape.species`. */
  species?: Species[];
}

const storedInventory = inventoryCreateSchema.partial();

export async function listInventory(): Promise<StockItem[]> {
  const records = await localStore().readRecordsByEntity('inventory');

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = storedInventory.safeParse(record.value);
      if (
        !parsed.success ||
        parsed.data.name === undefined ||
        parsed.data.kind === undefined ||
        parsed.data.unit === undefined
      ) {
        return [];
      }

      const { name, kind, unit, quantity, ...rest } = parsed.data;
      return [
        {
          id: record.targetId,
          name,
          kind,
          unit,
          quantity: quantity ?? 0,
          ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
        } satisfies StockItem,
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Items at or below the level their owner said to reorder at. */
export function runningLow(items: readonly StockItem[]): StockItem[] {
  return items.filter((i) => i.reorderBelow !== undefined && i.quantity <= i.reorderBelow);
}
