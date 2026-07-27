import { z } from 'zod';
import { equipmentCreateSchema } from '@steading/contracts';
import { readRecordsByEntity } from '../db/open';

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
    readRecordsByEntity('equipment'),
    readRecordsByEntity('hourReading'),
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
