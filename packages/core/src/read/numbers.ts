import { listBeds, listHarvests, listPlantings, listVarieties } from './growing';

/**
 * What came off the farm, this season and last.
 *
 * ## Two columns, not one
 *
 * The single most valuable thing this app has that a notebook does not is the
 * previous year, sitting beside this one. `ROADMAP.md` makes that argument
 * about the whole product — *a year of comparison is the app's second-year
 * value* — and a totals screen showing only the season in progress would throw
 * away the only number that means anything in August: what the same bed did by
 * this point last year.
 *
 * So every figure here is a pair, and the pair is the point.
 *
 * ## Yield, not money
 *
 * Cost data exists and is deliberately not on this screen yet. A numbers screen
 * that shows what came off and what it cost is a different, larger thing — it
 * needs feed apportioned across groups, a position on unpaid labour, and an
 * opinion about whether a barn is a cost or an asset. Answering half of that
 * badly is worse than answering none of it, and the yield half is useful on its
 * own from the first harvest.
 *
 * ## Derived, never stored
 *
 * The same rule the due engine follows and for the same reason: a sum kept in
 * step with an append-only log is a sum that will one day disagree with it.
 * `listHarvests` says so itself — *the sum is a question, not a fact to keep in
 * step*.
 */

export interface CropTotal {
  crop: string;
  /** Micrograms picked. Zero when a crop is only ever counted. */
  massUg: number;
  /** Things picked, for crops nobody weighs. */
  count: number;
  /** How many separate pickings, which is the shape of a season. */
  picks: number;
}

export interface BedTotal {
  bedId: string;
  bed: string;
  massUg: number;
  count: number;
  picks: number;
  /** What was grown there, in the order it was planted. */
  crops: string[];
}

export interface SeasonNumbers {
  season: number;
  massUg: number;
  count: number;
  picks: number;
  /** Plantings that went in, whatever became of them. */
  plantings: number;
  byCrop: CropTotal[];
  byBed: BedTotal[];
}

export interface Numbers {
  /** The season in progress. */
  now: SeasonNumbers;
  /**
   * The one before it, or null on a farm's first year.
   *
   * Null rather than an empty season, because "nothing last year" and "no last
   * year" are different sentences and the screen says a different thing for
   * each.
   */
  before: SeasonNumbers | null;
}

function empty(season: number): SeasonNumbers {
  return { season, massUg: 0, count: 0, picks: 0, plantings: 0, byCrop: [], byBed: [] };
}

/**
 * Everything the farm picked, by season, by crop and by bed.
 *
 * One pass over three lists rather than a query per section: the whole point of
 * the local store is that this is cheap, and a screen that made twelve reads
 * would be slower on a handset than the arithmetic it was avoiding.
 */
export async function readNumbers(thisSeason = new Date().getFullYear()): Promise<Numbers> {
  const [plantings, harvests, varieties, beds] = await Promise.all([
    listPlantings(),
    listHarvests(),
    listVarieties(),
    listBeds(),
  ]);

  const cropOf = new Map(varieties.map((v) => [v.id, v.crop]));
  const bedNameOf = new Map(beds.map((b) => [b.id, b.name]));
  const plantingById = new Map(plantings.map((p) => [p.id, p]));

  const seasons = new Map<number, SeasonNumbers>();
  const season = (n: number): SeasonNumbers => {
    const found = seasons.get(n);
    if (found !== undefined) return found;
    const made = empty(n);
    seasons.set(n, made);
    return made;
  };

  const crops = new Map<string, Map<string, CropTotal>>();
  const bedTotals = new Map<string, Map<string, BedTotal>>();
  const key = (n: number): string => String(n);

  for (const planting of plantings) {
    season(planting.season).plantings += 1;

    /**
     * A bed appears with what was planted in it even before anything is picked.
     * An empty bed and a bed with nothing off it yet are different states of
     * the same season, and only one of them is a question.
     */
    const bedsFor = bedTotals.get(key(planting.season)) ?? new Map<string, BedTotal>();
    const row = bedsFor.get(planting.bedId) ?? {
      bedId: planting.bedId,
      bed: bedNameOf.get(planting.bedId) ?? 'A bed',
      massUg: 0,
      count: 0,
      picks: 0,
      crops: [],
    };
    const crop = cropOf.get(planting.varietyId);
    if (crop !== undefined && !row.crops.includes(crop)) row.crops.push(crop);
    bedsFor.set(planting.bedId, row);
    bedTotals.set(key(planting.season), bedsFor);
  }

  /**
   * ── A pick belongs to the year it was picked ──────────────────────────────
   *
   * This bucketed by `planting.season`, which is stamped when the planting is
   * created and never moves. Every other column on this screen buckets by when
   * the thing happened, and for an annual sown and picked inside one year the
   * two agree — which is why it read correctly for as long as nobody grew
   * anything else.
   *
   * They are not the same question for anything that overwinters or comes back,
   * and those are first-class shapes in the bundled library rather than corner
   * cases. `library/crops.ts` has garlic as autumn-sown, and asparagus,
   * rhubarb, raspberry, blueberry and strawberry as perennials:
   *
   * | record                                  | reality      | screen said        |
   * |-----------------------------------------|--------------|--------------------|
   * | Rhubarb crown, season 2024; 8 kg May 26  | 8 kg in 2026 | 2026: 0 kg, 0 picks|
   * | Garlic sown Oct 2025; 3 kg lifted Jul 26 | 3 kg in 2026 | filed under 2025   |
   *
   * A perennial bed is the worst of the two: its planting is stamped once, so
   * every year after the first reports nothing off it for ever, and the
   * previous-season column — the reason this screen exists — compares a year
   * of picking against a year that was credited with all of it.
   *
   * **The planting count stays on `planting.season`.** That is a different
   * question and the answer to it is right: a crown put in during 2024 went in
   * in 2024 however long it goes on cropping.
   */
  for (const harvest of harvests) {
    const planting = plantingById.get(harvest.plantingId);
    // A pick whose planting has gone is not counted against a season it cannot
    // be placed in. It is not lost — the row is still in the store.
    if (planting === undefined) continue;

    const picked = new Date(harvest.occurredAt).getFullYear();
    const into = season(picked);
    const mass = harvest.massUg ?? 0;
    const number = harvest.count ?? 0;

    into.massUg += mass;
    into.count += number;
    into.picks += 1;

    const crop = cropOf.get(planting.varietyId) ?? 'Something';
    const cropsFor = crops.get(key(picked)) ?? new Map<string, CropTotal>();
    const cropRow = cropsFor.get(crop) ?? { crop, massUg: 0, count: 0, picks: 0 };
    cropRow.massUg += mass;
    cropRow.count += number;
    cropRow.picks += 1;
    cropsFor.set(crop, cropRow);
    crops.set(key(picked), cropsFor);

    /**
     * The bed row is seeded here when the year has none, rather than the pick
     * being dropped.
     *
     * The loop above creates a bed row for every season something was PLANTED
     * in, and this used to look one up and silently skip when it was missing —
     * which was invisible while the two keys agreed. Keyed by the picking year
     * they often do not: a bed whose only planting was a 2024 crown has no 2026
     * row, so eight kilos would have counted in the season total and appeared
     * against no bed at all. `byBed` must sum to the season it is under, or the
     * screen contradicts itself in the space of two rows.
     */
    const bedsFor = bedTotals.get(key(picked)) ?? new Map<string, BedTotal>();
    const bedRow = bedsFor.get(planting.bedId) ?? {
      bedId: planting.bedId,
      bed: bedNameOf.get(planting.bedId) ?? 'A bed',
      massUg: 0,
      count: 0,
      picks: 0,
      crops: [],
    };
    // Named the same way the planting loop names it: a variety whose crop is
    // unknown adds nothing to the bed's list rather than adding "Something".
    const bedCrop = cropOf.get(planting.varietyId);
    if (bedCrop !== undefined && !bedRow.crops.includes(bedCrop)) bedRow.crops.push(bedCrop);
    bedRow.massUg += mass;
    bedRow.count += number;
    bedRow.picks += 1;
    bedsFor.set(planting.bedId, bedRow);
    bedTotals.set(key(picked), bedsFor);
  }

  const assemble = (n: number): SeasonNumbers => {
    const totals = seasons.get(n) ?? empty(n);
    return {
      ...totals,
      // Heaviest first, then most numerous — a season is read by what there was
      // most of, not alphabetically.
      byCrop: [...(crops.get(key(n))?.values() ?? [])].sort(
        (a, b) => b.massUg - a.massUg || b.count - a.count || a.crop.localeCompare(b.crop),
      ),
      byBed: [...(bedTotals.get(key(n))?.values() ?? [])].sort(
        (a, b) => b.massUg - a.massUg || b.count - a.count || a.bed.localeCompare(b.bed),
      ),
    };
  };

  const previous = thisSeason - 1;
  const hadOne = seasons.has(previous);

  return { now: assemble(thisSeason), before: hadOne ? assemble(previous) : null };
}
