import { z } from 'zod';
import {
  ENTERPRISES,
  type Enterprise,
  bedCreateSchema,
  type FrostDates,
  frostDatesSchema,
  harvestCreateSchema,
  plantingCreateSchema,
  siteCreateSchema,
  varietyCreateSchema,
  type Zone,
  zoneSchema,
} from '@steading/contracts';
import { localStore } from '../db/store';

/**
 * Local-first reads for growing.
 *
 * The same shape as `groups.ts` and `iron.ts`, from the same projection. A
 * farm's beds are not a different kind of thing from its animals as far as
 * this layer is concerned — both are records the device already holds, and
 * both render with the radio off.
 */

export interface Site {
  id: string;
  name: string;
  /**
   * What this farm runs. Always populated — a site that has never been asked
   * reads as all of them, so no caller has to know the difference between
   * "everything" and "not answered".
   */
  enterprises: Enterprise[];
  zone?: Zone;
  frost?: FrostDates;
  rotationYears: number;
  postalCode?: string;
}

export interface Bed {
  id: string;
  siteId: string;
  name: string;
  covered: boolean;
  note?: string;
}

export interface Planting {
  id: string;
  bedId: string;
  varietyId: string;
  season: number;
  status: string;
  plannedSowAt?: number;
  plannedStartIndoorsAt?: number;
  plannedTransplantAt?: number;
  plannedFirstHarvestAt?: number;
  sownAt?: number;
  transplantedAt?: number;
  startedIndoorsAt?: number;
  removedAt?: number;
}

const storedSite = siteCreateSchema.partial();
const storedBed = bedCreateSchema.partial();
const storedPlanting = plantingCreateSchema.partial();

/**
 * The farm's site, or null before setup.
 *
 * One site is the overwhelming case, so this returns the first rather than a
 * list. A farm with a home plot and a rented field two valleys over has two
 * genuinely different frost dates and the schema supports it; the screens do
 * not yet, and pretending otherwise here would be a list nothing reads.
 */
export async function readSite(): Promise<Site | null> {
  const records = await localStore().readRecordsByEntity('site');

  for (const record of records) {
    if (record.deleted) continue;
    const parsed = storedSite.safeParse(record.value);
    if (!parsed.success || parsed.data.name === undefined) continue;

    const zone = zoneSchema.safeParse(parsed.data.zone);
    const frost = frostDatesSchema.safeParse(parsed.data.frost);

    return {
      id: record.targetId,
      name: parsed.data.name,
      ...(zone.success ? { zone: zone.data } : {}),
      ...(frost.success ? { frost: frost.data } : {}),
      ...(parsed.data.postalCode === undefined ? {} : { postalCode: parsed.data.postalCode }),
      // Three is the common smallholding figure. A farm with four beds
      // physically cannot manage four, which is why it is a setting.
      rotationYears: parsed.data.rotationYears ?? 3,
      /**
       * Absent means all of them — a farm that has never opened the screen
       * must not lose half its app. A stored empty array is different: that is
       * a farm that deliberately said "none", and it survives as one.
       */
      enterprises: parsed.data.enterprises === undefined
        ? [...ENTERPRISES]
        : [...parsed.data.enterprises],
    };
  }

  return null;
}

export async function listBeds(): Promise<Bed[]> {
  const records = await localStore().readRecordsByEntity('bed');

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = storedBed.safeParse(record.value);
      // A record that no longer matches the contract is skipped rather than
      // rendered half-formed; the diagnostics sheet reports the discrepancy.
      if (!parsed.success || parsed.data.name === undefined || parsed.data.siteId === undefined) {
        return [];
      }

      return [
        {
          id: record.targetId,
          siteId: parsed.data.siteId,
          name: parsed.data.name,
          covered: parsed.data.covered ?? false,
          ...(parsed.data.note === undefined ? {} : { note: parsed.data.note }),
        } satisfies Bed,
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listPlantings(): Promise<Planting[]> {
  const records = await localStore().readRecordsByEntity('planting');

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = storedPlanting.safeParse(record.value);
      if (
        !parsed.success ||
        parsed.data.bedId === undefined ||
        parsed.data.varietyId === undefined ||
        parsed.data.season === undefined ||
        parsed.data.status === undefined
      ) {
        return [];
      }

      const { bedId, varietyId, season, status, ...rest } = parsed.data;
      return [
        {
          id: record.targetId,
          bedId,
          varietyId,
          season,
          status,
          ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
        } satisfies Planting,
      ];
    });
}

/**
 * What is currently in a bed.
 *
 * Derived, never stored. A bed's occupancy changes several times a year and a
 * stored "current crop" would be wrong the moment anything was pulled — so
 * occupancy is "a planting that went in and has not been removed", which for a
 * perennial is the normal state for years.
 */
export function occupants(plantings: readonly Planting[], bedId: string): Planting[] {
  return plantings.filter(
    (p) =>
      p.bedId === bedId &&
      p.removedAt === undefined &&
      p.status !== 'finished' &&
      p.status !== 'failed',
  );
}

/** Varieties the farm has taken from the library or added itself. */
export async function listVarieties(): Promise<{ id: string; name: string; crop: string }[]> {
  const records = await localStore().readRecordsByEntity('variety');
  const stored = varietyCreateSchema.partial();

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = stored.safeParse(record.value);
      if (!parsed.success || parsed.data.name === undefined || parsed.data.crop === undefined) {
        return [];
      }
      return [{ id: record.targetId, name: parsed.data.name, crop: parsed.data.crop }];
    })
    .sort((a, b) => a.crop.localeCompare(b.crop) || a.name.localeCompare(b.name));
}

// ── harvests ─────────────────────────────────────────────────────────────────

export interface Harvest {
  id: string;
  plantingId: string;
  occurredAt: number;
  unit: string;
  massUg?: number;
  count?: number;
  note?: string;
}

const storedHarvest = z.object(harvestCreateSchema.shape).partial();

/**
 * What came off, append-only.
 *
 * Two people picking the same bed on the same morning produce two rows and
 * both are true — which is the whole reason an observation cannot conflict.
 * Nothing here sums into a stored total for the same reason nothing stores a
 * bed's current crop: the sum is a question, not a fact to keep in step.
 */
export async function listHarvests(): Promise<Harvest[]> {
  const records = await localStore().readRecordsByEntity('harvest');

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = storedHarvest.safeParse(record.value);
      if (
        !parsed.success ||
        parsed.data.plantingId === undefined ||
        parsed.data.occurredAt === undefined ||
        parsed.data.unit === undefined
      ) {
        return [];
      }

      const { plantingId, occurredAt, unit, ...rest } = parsed.data;
      return [
        {
          id: record.targetId,
          plantingId,
          occurredAt,
          unit,
          ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
        } satisfies Harvest,
      ];
    })
    .sort((a, b) => b.occurredAt - a.occurredAt);
}

/** Everything picked off one planting, and what it came to. */
export function harvestTotals(
  harvests: readonly Harvest[],
  plantingId: string,
): { massUg: number; count: number; picks: number } {
  let massUg = 0;
  let count = 0;
  let picks = 0;

  for (const harvest of harvests) {
    if (harvest.plantingId !== plantingId) continue;
    picks += 1;
    massUg += harvest.massUg ?? 0;
    count += harvest.count ?? 0;
  }

  return { massUg, count, picks };
}
