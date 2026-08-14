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
  /**
   * The variety's days to maturity, when the farm's record has one.
   *
   * Only used to re-anchor the harvest below. Absent for a variety somebody
   * added themselves without filling it in, which is a supported state — the
   * planned date is then the only estimate there is.
   */
  daysToMaturity?: number | undefined;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * When a planting should be ready, counted from the day it actually went in.
 *
 * Exported because three places need the same answer and were never going to
 * agree on it independently: the due row below, the planting screen, and the
 * bed card on Growing — which showed a raw status and no date at all, so a farm
 * that knew the days to maturity was told *"Roma · in-ground"* and left to work
 * the rest out.
 *
 * ## Counted from the day it went in, not from the day it was meant to
 *
 * **Reported from a farm: a pumpkin put in the ground today was fifteen days
 * overdue to harvest.** `plannedFirstHarvestAt` is computed once, when the
 * planting is created, from the site's frost dates — "sow this many weeks after
 * last frost, add days to maturity". That is a forecast for something not yet
 * planted, and it was the only thing this used to look at. Plant late and the
 * app announces a harvest that is already behind you.
 *
 * A plant does not know what the schedule said. It takes its days from the day
 * it was sown or set out, so that is the anchor: `transplantedAt` when there is
 * one, `sownAt` otherwise. That order is also how seed catalogues count — days
 * to maturity runs from transplant for a crop raised indoors and from sowing
 * for one direct sown.
 *
 * The planned date stays as the estimate for a planting that has not gone in
 * yet, and for a variety with no days to maturity — a farm's own addition it
 * has not filled in — because a rough date beats no date.
 *
 * Undefined when neither is known, which a caller must say nothing about rather
 * than guess at.
 */
export function expectedHarvestAt(
  planting: {
    sownAt?: number | undefined;
    transplantedAt?: number | undefined;
    plannedFirstHarvestAt?: number | undefined;
  },
  daysToMaturity: number | undefined,
): number | undefined {
  const anchor = planting.transplantedAt ?? planting.sownAt;
  if (anchor === undefined || daysToMaturity === undefined) {
    return planting.plannedFirstHarvestAt;
  }
  return anchor + daysToMaturity * DAY;
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

  /**
   * Being in the ground counts as sown, whichever button said so.
   *
   * Reported from a farm: *"when I push In-Ground on a plant, Sowed it should
   * automatically check itself off."* Quite right — a thing that has been
   * planted out is not waiting to be sown, and a row saying otherwise is the
   * app being confidently wrong about a bed somebody is standing in front of.
   *
   * Derived rather than written, so it also settles the records that already
   * carry a transplant and no sowing. Nothing rewrites a farm's history to fix
   * a row this could simply stop asking for.
   */
  add(
    'sow',
    planting.plannedSowAt,
    planting.sownAt ?? planting.transplantedAt,
    `Sow ${names.variety} in ${names.bed}`,
  );

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
   *
   * The date itself is `expectedHarvestAt` above, which is where the reasoning
   * about anchoring on what actually happened now lives — it is shared with the
   * two screens that show the same estimate.
   */
  if (planting.status !== 'harvesting') {
    add(
      'harvest',
      expectedHarvestAt(planting, names.daysToMaturity),
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
