import { DEFAULT_NOTICE_DAYS } from './notice';
import type { Due } from './types';

/**
 * Growing dues — sow, transplant, harvest.
 *
 * The rule that makes this small: **a stage that already happened produces no
 * row.** There is no completion flag anywhere; a planting with `sownAt` set
 * simply does not yield a sow due on the next recomputation, because the
 * record it was waiting for exists. That is the whole clearing mechanism.
 */

/** The fields this module needs. Anything richer is the caller's business. */
export interface PlantingRecord {
  id: string;
  bedId: string;
  varietyId: string;
  status: string;
  plannedStartIndoorsAt?: number | undefined;
  plannedTransplantAt?: number | undefined;
  plannedSowAt?: number | undefined;
  plannedFirstHarvestAt?: number | undefined;
  startedIndoorsAt?: number | undefined;
  sownAt?: number | undefined;
  transplantedAt?: number | undefined;
  removedAt?: number | undefined;
}

/** Names, so a row can say "Sow Sungold in Bed 3" rather than two ULIDs. */
export interface PlantingNames {
  variety: string;
  bed: string;
}

/**
 * Statuses that produce nothing.
 *
 * A failed planting is deliberately included. A row that died in May must not
 * spend the rest of the summer telling someone to harvest it — that is the
 * single most common way a derived list becomes noise, and noise is how a
 * farmer learns to ignore the one row that mattered.
 */
const CLOSED_STATUSES = new Set(['finished', 'failed']);

export function growingDues(
  planting: PlantingRecord,
  names: PlantingNames,
  noticeDays: Partial<Record<string, number>> = {},
): Due[] {
  if (CLOSED_STATUSES.has(planting.status) || planting.removedAt !== undefined) return [];

  const dues: Due[] = [];
  const subject = { entity: 'planting' as const, id: planting.id };

  const add = (
    kind: 'start-indoors' | 'sow' | 'transplant' | 'harvest',
    at: number | undefined,
    done: number | undefined,
    title: string,
  ): void => {
    if (at === undefined || done !== undefined) return;
    dues.push({
      key: `${planting.id}:${kind}`,
      kind,
      subject,
      title,
      at,
      atReading: null,
      projectedAt: null,
      noticeDays: noticeDays[kind] ?? DEFAULT_NOTICE_DAYS[kind],
    });
  };

  add(
    'start-indoors',
    planting.plannedStartIndoorsAt,
    planting.startedIndoorsAt,
    `Start ${names.variety} indoors`,
  );

  add('sow', planting.plannedSowAt, planting.sownAt, `Sow ${names.variety} in ${names.bed}`);

  /**
   * A transplant waits on its own start, not on the sow date.
   *
   * Seedlings that were never started cannot be moved out, and a row telling
   * someone to transplant an empty tray is worse than no row: it is the app
   * being confidently wrong about the state of their propagator.
   */
  if (planting.plannedStartIndoorsAt === undefined || planting.startedIndoorsAt !== undefined) {
    add(
      'transplant',
      planting.plannedTransplantAt,
      planting.transplantedAt,
      `Plant out ${names.variety} into ${names.bed}`,
    );
  }

  /**
   * Harvest is the one stage with no completion field of its own — picking is
   * append-only and goes on for weeks. It clears when the planting is moved to
   * `harvesting` or beyond, which is what the status is for.
   */
  if (planting.status !== 'harvesting') {
    add(
      'harvest',
      planting.plannedFirstHarvestAt,
      undefined,
      `${names.variety} should be ready in ${names.bed}`,
    );
  }

  return dues;
}

/**
 * Whether putting this family in this bed breaks the rotation.
 *
 * Brassicas following brassicas build up club root; solanaceae following
 * solanaceae build up blight. `rotationYears` is a site setting rather than a
 * constant because a farm with four beds physically cannot run a four-year
 * rotation, and an app that insists is an app that gets ignored.
 *
 * Returns the most recent offending season, or null. A warning, never a block
 * — the same rule as hardiness, and for the same reason.
 */
export function rotationConflict(
  family: string,
  seasonsInBed: readonly { season: number; family: string }[],
  season: number,
  rotationYears: number,
): number | null {
  if (rotationYears <= 0) return null;

  const offending = seasonsInBed
    .filter((s) => s.family === family && s.season < season && s.season > season - 1 - rotationYears)
    .map((s) => s.season);

  return offending.length === 0 ? null : Math.max(...offending);
}
