import { z } from 'zod';
import { frostDatesSchema } from '../growing/frost';
import { zoneSchema } from '../growing/zone';
import { deciCelsiusSchema, microgramsSchema, micrometresSchema, unitSystemSchema } from '../units';

/**
 * Growing — beds, varieties, plantings, harvests, and the site they all sit in.
 *
 * Five entities and the discipline is to stop there. Succession is not a sixth:
 * it is a planting with a repeat interval that generates the next one. Rotation
 * is not a seventh: it is a query over plantings by family.
 */

// ── site (mutable) ───────────────────────────────────────────────────────────

/**
 * Where the farm is, in the two senses that matter.
 *
 * **Zone and frost dates are both stored, because they answer different
 * questions.** The zone is the average annual minimum winter temperature and
 * decides what survives — fruit trees, asparagus, rhubarb, canes, perennial
 * herbs. The frost dates are the growing window and decide when every annual
 * goes in. Neither can be computed from the other; a farm needs both.
 *
 * A site rather than a column on the org, because a farm with a home plot and
 * a rented field two valleys over genuinely has two frost dates, and beds
 * belong to one or the other. Most farms will have exactly one and never think
 * about it.
 */
/**
 * The parts of a farm this operation actually runs.
 *
 * A market gardener has no stock. A poultry keeper on a suburban plot has no
 * tractor and no beds. Both currently get four tabs, two of which will be
 * empty forever, and every screen that lists what you can do offers them
 * things they will never want. An app that asks once and then stops asking is
 * a smaller app for everybody.
 *
 * **Coarse on purpose.** This says whether a whole area of the farm exists,
 * not what any individual animal is for — that is `purposes` on the group, and
 * it already decides per flock whether the processing clock runs or an egg
 * tally appears. Two settings answering the same question is how they end up
 * disagreeing.
 *
 * **Absent means all of them**, which is what every farm that has never opened
 * the screen has. Turning the feature on must not empty an existing farm's
 * app, and a stored empty array is a farm that has deliberately said "none" —
 * a real answer that has to survive a round trip, and therefore cannot be the
 * same value as "never asked".
 */
export const ENTERPRISES = ['stock', 'growing', 'iron'] as const;
export type Enterprise = (typeof ENTERPRISES)[number];

export const enterpriseSchema = z.enum(ENTERPRISES);

const siteShape = {
  name: z.string().min(1).max(80),
  /**
   * Which parts of the app this farm uses. Undefined means all of them.
   *
   * Hiding, never deleting (invariant 13). A farm that switches Growing off
   * keeps every planting and every harvest; the tab stops appearing and the
   * records are exactly where they were when it comes back.
   */
  enterprises: z.array(enterpriseSchema).max(ENTERPRISES.length).optional(),
  /** US postcode, for the bundled zone lookup. Optional everywhere else. */
  postalCode: z.string().max(12).optional(),
  zone: zoneSchema.optional(),
  frost: frostDatesSchema.optional(),
  /** Elevation moves a frost date more than a postcode does. Recorded, not used yet. */
  elevationUm: micrometresSchema.optional(),
  units: unitSystemSchema.optional(),
  /**
   * Years before the same plant family may return to a bed. Three is the
   * common smallholding figure; a farm with four beds physically cannot manage
   * four, so this is a setting rather than a constant.
   */
  rotationYears: z.number().int().min(0).max(10).optional(),
};

export const siteCreateSchema = z.object(siteShape).strict();
export const siteUpdateSchema = z.object(siteShape).partial().strict();

// ── bed (mutable) ────────────────────────────────────────────────────────────

export const SUN_EXPOSURES = ['full', 'partial', 'shade'] as const;
export const sunExposureSchema = z.enum(SUN_EXPOSURES);

/**
 * A place you plant. A raised bed, a row, a plot, a tunnel, a block of trees.
 *
 * Deliberately long-lived and deliberately thin. What is IN a bed is not a
 * field here — it is derived from plantings, because a bed's occupancy changes
 * several times a year and a stored "current crop" would be wrong the moment
 * anything is pulled.
 */
const bedShape = {
  siteId: z.string().length(26),
  name: z.string().min(1).max(80),
  lengthUm: micrometresSchema.optional(),
  widthUm: micrometresSchema.optional(),
  sun: sunExposureSchema.optional(),
  /** A tunnel or frame beats the site's frost dates, so it is worth knowing. */
  covered: z.boolean().optional(),
  note: z.string().max(500).optional(),
};

export const bedCreateSchema = z.object(bedShape).strict();
export const bedUpdateSchema = z.object(bedShape).partial().strict();

// ── variety (mutable) ────────────────────────────────────────────────────────

/**
 * Plant families, for rotation.
 *
 * The reason a variety carries a family at all: brassicas following brassicas
 * build up club root, and solanaceae following solanaceae build up blight.
 * Rotation warnings compare this field and nothing else.
 */
export const PLANT_FAMILIES = [
  'allium',
  'brassica',
  'chenopod',
  'cucurbit',
  'grass',
  'legume',
  'solanaceae',
  'umbellifer',
  'aster',
  'other',
] as const;
export const plantFamilySchema = z.enum(PLANT_FAMILIES);

export const LIFECYCLES = ['annual', 'biennial', 'perennial'] as const;
export const lifecycleSchema = z.enum(LIFECYCLES);

/**
 * Something you can plant.
 *
 * Mutable, and that is the point of the bundled reference library: about sixty
 * varieties ship with the numbers filled in, and a farm's own edits win. A
 * grower who knows their Sungold ripens ten days earlier than the packet says
 * must be able to say so, and the app must then believe them.
 */
const varietyShape = {
  name: z.string().min(1).max(80),
  /** 'Tomato', 'Kale'. The crop; `name` is the cultivar. */
  crop: z.string().min(1).max(60),
  family: plantFamilySchema,
  lifecycle: lifecycleSchema,

  /**
   * Coldest temperature this plant survives, for the hardiness warning.
   * Perennials only in practice — an annual dies at first frost by definition,
   * which is what the frost dates are for.
   */
  hardyToDeciC: deciCelsiusSchema.optional(),

  // Timing. Every field optional because they genuinely vary: garlic is
  // autumn-sown and has no spring anchor; lettuce has no indoor stage.
  startIndoorsWeeksBefore: z.number().int().min(0).max(26).optional(),
  transplantWeeksAfter: z.number().int().min(-12).max(26).optional(),
  directSowWeeksAfter: z.number().int().min(-12).max(26).optional(),
  autumnSowWeeksBefore: z.number().int().min(0).max(26).optional(),
  daysToMaturity: z.number().int().min(1).max(1500).optional(),

  // Spacing, in the canonical base unit. Displayed in inches by default.
  spacingUm: micrometresSchema.optional(),
  rowSpacingUm: micrometresSchema.optional(),
  sowDepthUm: micrometresSchema.optional(),

  /** Days between successive sowings, for crops that are sown in waves. */
  successionDays: z.number().int().min(1).max(120).optional(),

  /** False for the bundled library, true for anything the farm added itself. */
  custom: z.boolean().optional(),
  note: z.string().max(1000).optional(),
};

export const varietyCreateSchema = z.object(varietyShape).strict();
export const varietyUpdateSchema = z.object(varietyShape).partial().strict();

// ── planting (mutable) ───────────────────────────────────────────────────────

/**
 * Planned and actual, side by side.
 *
 * Multi-year planning means a row can exist for 2028 with nothing sown in it,
 * so the planned dates are the schedule and the actual dates are what
 * happened. Keeping both is what lets the app say "you sowed this three weeks
 * late last year" instead of quietly overwriting the plan with reality and
 * losing the fact that they diverged.
 */
export const PLANTING_STATUSES = [
  'planned',
  'started',
  'in-ground',
  'harvesting',
  'finished',
  'failed',
] as const;
export const plantingStatusSchema = z.enum(PLANTING_STATUSES);

const plantingShape = {
  bedId: z.string().length(26),
  varietyId: z.string().length(26),
  /**
   * The calendar year this planting belongs to.
   *
   * Stored rather than derived from a date, because a planned row has no dates
   * yet and a perennial spans many years — the season is the year it went in,
   * which is the year the plan was made for.
   */
  season: z.number().int().min(2000).max(2200),
  status: plantingStatusSchema,

  // Planned, from the variety and the site's frost dates.
  plannedStartIndoorsAt: z.number().int().optional(),
  plannedTransplantAt: z.number().int().optional(),
  plannedSowAt: z.number().int().optional(),
  plannedFirstHarvestAt: z.number().int().optional(),

  // Actual.
  startedIndoorsAt: z.number().int().optional(),
  sownAt: z.number().int().optional(),
  transplantedAt: z.number().int().optional(),
  /**
   * When the plant left the bed. Absent means it is still there — which for a
   * perennial is the normal state for years, and is how bed occupancy is
   * computed without storing it anywhere.
   */
  removedAt: z.number().int().optional(),

  quantity: z.number().int().min(1).max(1_000_000).optional(),
  note: z.string().max(1000).optional(),
};

export const plantingCreateSchema = z.object(plantingShape).strict();
export const plantingUpdateSchema = z.object(plantingShape).partial().strict();

// ── harvest (append-only) ────────────────────────────────────────────────────

export const HARVEST_UNITS = ['mass', 'count', 'bunch'] as const;
export const harvestUnitSchema = z.enum(HARVEST_UNITS);

/**
 * What came off a planting. Append-only, exactly like `eggLog`.
 *
 * An observation cannot conflict, which is the whole reason for the
 * classification: two people picking the same bed on the same morning produce
 * two harvest rows, and both are true.
 *
 * Mass and count are separate fields rather than one number with a unit tag,
 * because summing them is the single most common thing anything does with
 * these rows and a tagged union makes every sum a branch.
 */
export const harvestCreateSchema = z
  .object({
    plantingId: z.string().length(26),
    occurredAt: z.number().int(),
    unit: harvestUnitSchema,
    massUg: microgramsSchema.optional(),
    count: z.number().int().min(1).max(1_000_000).optional(),
    note: z.string().max(300).optional(),
  })
  .strict()
  .refine((h) => (h.unit === 'mass' ? h.massUg !== undefined : h.count !== undefined), {
    message: 'A mass harvest needs massUg; a count or bunch harvest needs count',
  });
