import type { CareKind } from '../entities/care';
import { SPECIES_TRAITS, type Species } from '../entities/livestock';
import type { Due } from './types';

/**
 * Routine husbandry, as intervals.
 *
 * The whole feature is this table plus twenty lines. That is the point the
 * scope doc was making: worming and hoof trimming are not a subsystem, they
 * are dates, and the due engine already knows what to do with a date.
 *
 * ## Why these are keyed by species group, not species
 *
 * Hooves grow at roughly the same rate on a goat and a sheep, and neither is a
 * chicken. Keying per species would be fifty rows repeating five answers, and
 * every new species would need someone to fill in a column they have no
 * opinion about — so the default falls out of the group and a farm overrides
 * what it disagrees with.
 *
 * ## These are defaults and they are conservative
 *
 * Every one of them is a "sooner than most farms need" figure, because the
 * cost of the two directions is not symmetric: an early reminder is dismissed
 * in a tap, and a late one is a lame goat. A farm that trims every twelve
 * weeks sets twelve and stops thinking about it.
 *
 * Worming especially. The interval below is a *reminder to assess*, not a
 * schedule to dose on — blanket worming on a calendar is how resistance is
 * built, and the honest thing an app can do is prompt a look rather than
 * prescribe a drench.
 */

type Group = (typeof SPECIES_TRAITS)[Species]['group'];

/** Days. `null` means the job does not apply to this kind of animal. */
type Intervals = Partial<Record<CareKind, number | null>>;

const POULTRY: Intervals = {
  'parasite-check': 30,
  'health-check': 30,
  vaccination: 365,
  worming: 120,
  'hoof-trim': null,
  mineral: null,
  dental: null,
};

const RUMINANT: Intervals = {
  'hoof-trim': 56,
  mineral: 30,
  worming: 90,
  'parasite-check': 60,
  'health-check': 30,
  vaccination: 365,
  dental: null,
};

const RATITE: Intervals = {
  'health-check': 30,
  'parasite-check': 60,
  worming: 120,
  'hoof-trim': null,
  mineral: null,
  vaccination: null,
  dental: null,
};

const OTHER: Intervals = {
  'health-check': 30,
  worming: 90,
  'parasite-check': 60,
  vaccination: 365,
  'hoof-trim': null,
  mineral: null,
  dental: null,
};

export const CARE_INTERVALS: Record<Group, Intervals> = {
  poultry: POULTRY,
  ruminant: RUMINANT,
  ratite: RATITE,
  other: OTHER,
};

/**
 * Species that want a job their group does not, or want it at a different
 * interval. Kept small on purpose — a long list here means the grouping is
 * wrong and should be fixed rather than papered over.
 */
const BY_SPECIES: Partial<Record<Species, Intervals>> = {
  // Feet grow fast and a horse that is not trimmed goes lame quickly. Teeth
  // are an annual job no other species on the list has.
  horse: { 'hoof-trim': 42, dental: 365, worming: 90, 'health-check': 30, vaccination: 365 },
  donkey: { 'hoof-trim': 56, dental: 365, worming: 90, 'health-check': 30, vaccination: 365 },
  // Cattle feet are trimmed far less often than a goat's.
  cattle: { 'hoof-trim': 182, mineral: 30, worming: 90, 'parasite-check': 60, 'health-check': 30, vaccination: 365 },
  // Camelids: toenails rather than hooves, and shorter than a cow.
  alpaca: { 'hoof-trim': 90, mineral: 60, worming: 90, 'health-check': 30, dental: 365 },
  llama: { 'hoof-trim': 90, mineral: 60, worming: 90, 'health-check': 30, dental: 365 },
};

/** How often a job comes round for this species, or null if it does not apply. */
export function careIntervalDays(species: Species, kind: CareKind): number | null {
  const specific = BY_SPECIES[species]?.[kind];
  if (specific !== undefined) return specific;

  const traits = SPECIES_TRAITS[species];
  return CARE_INTERVALS[traits.group][kind] ?? null;
}

const DAY_MS = 86_400_000;

/**
 * Two weeks' notice on everything here.
 *
 * Long enough to buy wormer or book the trimmer, short enough that a screen
 * read at 6am is not mostly things due next month. Overridable per farm; the
 * scope doc's per-kind notice table covers the *kinds*, and every one of these
 * is the same kind of job.
 */
const NOTICE_DAYS = 14;

export interface CareGroup {
  id: string;
  name: string;
  species: Species;
  /** When each job was last done. Absent means never. */
  lastDone: Partial<Record<CareKind, number>>;
  /** Per-farm overrides, in days. `null` silences a job entirely. */
  intervals?: Partial<Record<CareKind, number | null>> | undefined;
}

const TITLES: Record<CareKind, string> = {
  worming: 'Worm check',
  'hoof-trim': 'Trim feet',
  mineral: 'Check minerals',
  vaccination: 'Vaccinations',
  'parasite-check': 'Check for parasites',
  dental: 'Teeth',
  'health-check': 'Look over',
};

/**
 * The husbandry due on one group.
 *
 * A job never done is due **now**, not one interval from today. A farm that
 * has never recorded trimming a goat's feet either has not been trimming them
 * or has not been recording it, and both are worth a row — starting the clock
 * from the moment the app was installed would tell someone their overdue herd
 * is fine for another eight weeks.
 */
export function careDues(group: CareGroup, now: number): Due[] {
  const dues: Due[] = [];

  for (const kind of Object.keys(TITLES) as CareKind[]) {
    const override = group.intervals?.[kind];
    // `null` silences; `undefined` means "no opinion", so fall through.
    const days = override === undefined ? careIntervalDays(group.species, kind) : override;
    if (days === null || days <= 0) continue;

    const last = group.lastDone[kind];

    dues.push({
      key: `${group.id}:care:${kind}`,
      kind: 'task',
      subject: { entity: 'flock', id: group.id },
      title: `${TITLES[kind]} — ${group.name}`,
      at: last === undefined ? now : last + days * DAY_MS,
      atReading: null,
      projectedAt: null,
      noticeDays: NOTICE_DAYS,
    });
  }

  return dues;
}
