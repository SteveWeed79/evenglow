import { z } from 'zod';
import {
  breedingCreateSchema,
  incubationCreateSchema,
  type Species,
  weightCreateSchema,
} from '@homefarm/contracts';
import { localStore } from '../db/store';

/**
 * Birthing and hatching, read back — and the weights that go with them.
 *
 * `birthDue` and `incubationDues` were built and tested long before anything
 * could write a `breeding` or `incubation` record. That is the gap this
 * closes: the arithmetic existed, the records were unreachable, so the two
 * loudest rows a smallholding's year turns on — a doe due to kid, a hatch on
 * Thursday — never appeared on Today for anyone.
 *
 * Both are mutable entities, which is unusual for this layer and correct here:
 * the outcome is filled in months after the record is created, and the record
 * has to exist from the mating for the date to be counted from it.
 */

export interface BreedingEntry {
  id: string;
  species: Species;
  damId: string;
  bredAt: number;
  method: string;
  sireId?: string;
  sireNote?: string;
  dueAtOverride?: number;
  bornAt?: number;
  liveBorn?: number;
  stillborn?: number;
  lost?: boolean;
  note?: string;
}

export interface IncubationEntry {
  id: string;
  species: Species;
  label: string;
  setAt: number;
  eggsSet: number;
  source: string;
  method: string;
  flockId?: string;
  /** What they are, when it was known when they went under. */
  breedId?: string;
  candledAt?: number;
  fertile?: number;
  hatchedAt?: number;
  hatched?: number;
  earlyLosses?: number;
  note?: string;
}

const storedBreeding = breedingCreateSchema.partial();
const storedIncubation = incubationCreateSchema.partial();

/**
 * Drops the undefined keys.
 *
 * `exactOptionalPropertyTypes` treats an absent property and one set to
 * `undefined` as different things, and a `.partial()` schema produces the
 * second. Spreading the filtered entries is what turns "present and undefined"
 * back into "absent", which is what the interfaces above actually declare.
 */
function defined(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

export async function listBreedings(): Promise<BreedingEntry[]> {
  const records = await localStore().readRecordsByEntity('breeding');

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = storedBreeding.safeParse(record.value);
      if (!parsed.success) return [];

      const { species, damId, bredAt, method, ...rest } = parsed.data;
      // A mating with no dam, no date or no species cannot produce a due row
      // and cannot be shown as anything; it is skipped rather than guessed at.
      if (species === undefined || damId === undefined || bredAt === undefined) return [];

      return [
        {
          id: record.targetId,
          species,
          damId,
          bredAt,
          method: method ?? 'natural',
          ...defined(rest),
        } satisfies BreedingEntry,
      ];
    })
    .sort((a, b) => b.bredAt - a.bredAt);
}

export async function listIncubations(): Promise<IncubationEntry[]> {
  const records = await localStore().readRecordsByEntity('incubation');

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = storedIncubation.safeParse(record.value);
      if (!parsed.success) return [];

      const { species, label, setAt, eggsSet, source, method, ...rest } = parsed.data;
      if (species === undefined || setAt === undefined) return [];

      return [
        {
          id: record.targetId,
          species,
          label: label ?? 'the',
          setAt,
          eggsSet: eggsSet ?? 0,
          source: source ?? 'own',
          method: method ?? 'incubator',
          ...defined(rest),
        } satisfies IncubationEntry,
      ];
    })
    .sort((a, b) => b.setAt - a.setAt);
}

/**
 * Hatch rate, as the two numbers that mean different things.
 *
 * `fertile` is what candling found and `hatched` is what came out, so a set
 * with poor fertility and a set with a failing incubator produce different
 * figures here — which is the entire reason candling is recorded separately.
 * Null rather than zero when the step has not happened: a set going under
 * today has no hatch rate, and 0% is a claim about a bad hatch.
 */
export function hatchRate(incubation: IncubationEntry): number | null {
  if (incubation.hatched === undefined || incubation.eggsSet === 0) return null;
  return incubation.hatched / incubation.eggsSet;
}

export function fertilityRate(incubation: IncubationEntry): number | null {
  if (incubation.fertile === undefined || incubation.eggsSet === 0) return null;
  return incubation.fertile / incubation.eggsSet;
}

// ── weights ──────────────────────────────────────────────────────────────────

export interface WeightEntry {
  id: string;
  occurredAt: number;
  massUg: number;
  animalId?: string;
  flockId?: string;
  sampled?: boolean;
  note?: string;
}

const storedWeight = z.object(weightCreateSchema.shape).partial();

/**
 * Every weighing, newest first.
 *
 * Append-only and never overwritten: one number says almost nothing and the
 * series says everything. `animal.weightGrams` is the last known figure for
 * display; this is the history behind it.
 */
export async function listWeights(): Promise<WeightEntry[]> {
  const records = await localStore().readRecordsByEntity('weight');

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = storedWeight.safeParse(record.value);
      if (!parsed.success || parsed.data.occurredAt === undefined || parsed.data.massUg === undefined) {
        return [];
      }

      const { occurredAt, massUg, ...rest } = parsed.data;
      return [{ id: record.targetId, occurredAt, massUg, ...defined(rest) } satisfies WeightEntry];
    })
    .sort((a, b) => b.occurredAt - a.occurredAt);
}

/** The latest weighing per subject, for a card that shows one number. */
export function latestWeightBySubject(entries: readonly WeightEntry[]): Map<string, WeightEntry> {
  const latest = new Map<string, WeightEntry>();

  for (const entry of entries) {
    const subject = entry.animalId ?? entry.flockId;
    if (subject === undefined) continue;

    const existing = latest.get(subject);
    if (existing === undefined || entry.occurredAt > existing.occurredAt) {
      latest.set(subject, entry);
    }
  }

  return latest;
}
