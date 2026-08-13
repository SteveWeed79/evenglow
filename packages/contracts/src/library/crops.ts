import type { LibraryVariety } from './types';

/**
 * What a crop needs, separately from which cultivar of it you grow.
 *
 * ## Why this split exists
 *
 * **Timing belongs to the crop; days to maturity belongs to the cultivar.**
 * Every tomato is started indoors six weeks before last frost and set out two
 * weeks after it, whether it is a Sungold at 57 days or a Brandywine at 85.
 * Spacing, sowing depth and family are the same — properties of the plant, not
 * of the seed company's name for it.
 *
 * Written out per cultivar, that is the same eight fields repeated for every
 * tomato in the library. Written here once, a new cultivar is a name and a
 * number.
 *
 * ## It is also the seam a bigger dataset lands in
 *
 * FAO's ECOCROP has environmental requirements for 2,568 species with a growth
 * cycle on every one of them, keyed by common name — which is exactly the shape
 * of the table below. Filling this from it is a data question and a licensing
 * one, not a code change, because this file is already the place it would go.
 *
 * ## What is not here
 *
 * Perennials that fruit for decades — berries, orchard trees, mushrooms.
 * `planting.season` is required and a blueberry bush planted in 2020 has one
 * planting, so every harvest since would file under 2020 and `readNumbers`
 * would compare the wrong years. That wants a decision about what a planting
 * means before it wants a list of names.
 */

/** Everything a crop contributes to a variety, minus the name and the days. */
export interface CropDefaults {
  family: LibraryVariety['family'];
  lifecycle: LibraryVariety['lifecycle'];
  startIndoorsWeeksBefore?: number;
  transplantWeeksAfter?: number;
  directSowWeeksAfter?: number;
  autumnSowWeeksBefore?: number;
  spacingIn?: number;
  rowSpacingIn?: number;
  sowDepthIn?: number;
  successionDays?: number;
}

/**
 * Keyed by the crop name exactly as it appears on a variety.
 *
 * Lower-cased on lookup, because a farm typing "pumpkin" into the add-your-own
 * form should get the same answer as the library's "Pumpkin".
 */
export const CROP_DEFAULTS: Readonly<Record<string, CropDefaults>> = {
  // ── solanaceae ─────────────────────────────────────────────────────────────
  Tomato: { family: 'solanaceae', lifecycle: 'annual', startIndoorsWeeksBefore: 6, transplantWeeksAfter: 2, spacingIn: 24, rowSpacingIn: 48, sowDepthIn: 0.25 },
  Pepper: { family: 'solanaceae', lifecycle: 'annual', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 2, spacingIn: 18, rowSpacingIn: 30, sowDepthIn: 0.25 },
  Eggplant: { family: 'solanaceae', lifecycle: 'annual', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 2, spacingIn: 24, rowSpacingIn: 36, sowDepthIn: 0.25 },
  Potato: { family: 'solanaceae', lifecycle: 'annual', directSowWeeksAfter: -2, spacingIn: 12, rowSpacingIn: 30, sowDepthIn: 4 },
  Tomatillo: { family: 'solanaceae', lifecycle: 'annual', startIndoorsWeeksBefore: 6, transplantWeeksAfter: 2, spacingIn: 30, rowSpacingIn: 48, sowDepthIn: 0.25 },
  'Ground cherry': { family: 'solanaceae', lifecycle: 'annual', startIndoorsWeeksBefore: 6, transplantWeeksAfter: 2, spacingIn: 24, rowSpacingIn: 36, sowDepthIn: 0.25 },
  'Cape gooseberry': { family: 'solanaceae', lifecycle: 'annual', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 2, spacingIn: 30, rowSpacingIn: 48, sowDepthIn: 0.25 },

  // ── cucurbits ──────────────────────────────────────────────────────────────
  'Summer squash': { family: 'cucurbit', lifecycle: 'annual', directSowWeeksAfter: 2, spacingIn: 24, rowSpacingIn: 48, sowDepthIn: 1, successionDays: 21 },
  'Winter squash': { family: 'cucurbit', lifecycle: 'annual', directSowWeeksAfter: 2, spacingIn: 36, rowSpacingIn: 72, sowDepthIn: 1 },
  Pumpkin: { family: 'cucurbit', lifecycle: 'annual', directSowWeeksAfter: 2, spacingIn: 36, rowSpacingIn: 72, sowDepthIn: 1 },
  Cucumber: { family: 'cucurbit', lifecycle: 'annual', directSowWeeksAfter: 2, spacingIn: 12, rowSpacingIn: 48, sowDepthIn: 1, successionDays: 21 },
  Watermelon: { family: 'cucurbit', lifecycle: 'annual', startIndoorsWeeksBefore: 3, transplantWeeksAfter: 2, spacingIn: 36, rowSpacingIn: 72, sowDepthIn: 1 },
  Cantaloupe: { family: 'cucurbit', lifecycle: 'annual', startIndoorsWeeksBefore: 3, transplantWeeksAfter: 2, spacingIn: 24, rowSpacingIn: 60, sowDepthIn: 1 },
  Melon: { family: 'cucurbit', lifecycle: 'annual', startIndoorsWeeksBefore: 3, transplantWeeksAfter: 2, spacingIn: 24, rowSpacingIn: 60, sowDepthIn: 1 },
  Gourd: { family: 'cucurbit', lifecycle: 'annual', directSowWeeksAfter: 2, spacingIn: 36, rowSpacingIn: 72, sowDepthIn: 1 },

  // ── brassicas ──────────────────────────────────────────────────────────────
  Cabbage: { family: 'brassica', lifecycle: 'annual', startIndoorsWeeksBefore: 6, transplantWeeksAfter: -3, spacingIn: 18, rowSpacingIn: 30, sowDepthIn: 0.25 },
  Kale: { family: 'brassica', lifecycle: 'biennial', startIndoorsWeeksBefore: 5, transplantWeeksAfter: -3, spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.25 },
  Broccoli: { family: 'brassica', lifecycle: 'annual', startIndoorsWeeksBefore: 6, transplantWeeksAfter: -3, spacingIn: 18, rowSpacingIn: 30, sowDepthIn: 0.25 },
  Cauliflower: { family: 'brassica', lifecycle: 'annual', startIndoorsWeeksBefore: 6, transplantWeeksAfter: -2, spacingIn: 18, rowSpacingIn: 30, sowDepthIn: 0.25 },
  'Brussels sprouts': { family: 'brassica', lifecycle: 'annual', startIndoorsWeeksBefore: 6, transplantWeeksAfter: 2, spacingIn: 24, rowSpacingIn: 30, sowDepthIn: 0.25 },
  'Pak choi': { family: 'brassica', lifecycle: 'annual', directSowWeeksAfter: -3, spacingIn: 8, rowSpacingIn: 12, sowDepthIn: 0.25, successionDays: 14 },
  'Chinese cabbage': { family: 'brassica', lifecycle: 'annual', directSowWeeksAfter: -2, spacingIn: 12, rowSpacingIn: 18, sowDepthIn: 0.25 },
  Mizuna: { family: 'brassica', lifecycle: 'annual', directSowWeeksAfter: -4, spacingIn: 6, rowSpacingIn: 12, sowDepthIn: 0.25, successionDays: 14 },
  Collards: { family: 'brassica', lifecycle: 'biennial', startIndoorsWeeksBefore: 5, transplantWeeksAfter: -3, spacingIn: 18, rowSpacingIn: 30, sowDepthIn: 0.25 },
  Mustard: { family: 'brassica', lifecycle: 'annual', directSowWeeksAfter: -4, spacingIn: 8, rowSpacingIn: 14, sowDepthIn: 0.25, successionDays: 14 },
  Turnip: { family: 'brassica', lifecycle: 'annual', directSowWeeksAfter: -4, spacingIn: 4, rowSpacingIn: 14, sowDepthIn: 0.5, successionDays: 14 },
  Rutabaga: { family: 'brassica', lifecycle: 'biennial', directSowWeeksAfter: 8, spacingIn: 6, rowSpacingIn: 18, sowDepthIn: 0.5 },
  Radish: { family: 'brassica', lifecycle: 'annual', directSowWeeksAfter: -4, spacingIn: 2, rowSpacingIn: 8, sowDepthIn: 0.5, successionDays: 10 },
  Daikon: { family: 'brassica', lifecycle: 'annual', directSowWeeksAfter: 8, spacingIn: 4, rowSpacingIn: 14, sowDepthIn: 0.5 },
  Arugula: { family: 'brassica', lifecycle: 'annual', directSowWeeksAfter: -4, spacingIn: 4, rowSpacingIn: 8, sowDepthIn: 0.25, successionDays: 10 },
  Kohlrabi: { family: 'brassica', lifecycle: 'annual', directSowWeeksAfter: -4, spacingIn: 6, rowSpacingIn: 12, sowDepthIn: 0.5, successionDays: 21 },
  Tatsoi: { family: 'brassica', lifecycle: 'annual', directSowWeeksAfter: -4, spacingIn: 6, rowSpacingIn: 12, sowDepthIn: 0.25, successionDays: 14 },
  Komatsuna: { family: 'brassica', lifecycle: 'annual', directSowWeeksAfter: -4, spacingIn: 6, rowSpacingIn: 12, sowDepthIn: 0.25, successionDays: 14 },
  'Choy sum': { family: 'brassica', lifecycle: 'annual', directSowWeeksAfter: -3, spacingIn: 8, rowSpacingIn: 12, sowDepthIn: 0.25, successionDays: 14 },
  'Gai lan': { family: 'brassica', lifecycle: 'annual', directSowWeeksAfter: -3, spacingIn: 8, rowSpacingIn: 14, sowDepthIn: 0.25, successionDays: 14 },
  'Broccoli raab': { family: 'brassica', lifecycle: 'annual', directSowWeeksAfter: -4, spacingIn: 6, rowSpacingIn: 12, sowDepthIn: 0.25, successionDays: 14 },

  // ── alliums ────────────────────────────────────────────────────────────────
  Garlic: { family: 'allium', lifecycle: 'biennial', autumnSowWeeksBefore: 3, spacingIn: 6, rowSpacingIn: 12, sowDepthIn: 2 },
  Onion: { family: 'allium', lifecycle: 'biennial', startIndoorsWeeksBefore: 10, transplantWeeksAfter: -4, spacingIn: 4, rowSpacingIn: 12, sowDepthIn: 0.25 },
  Shallot: { family: 'allium', lifecycle: 'biennial', autumnSowWeeksBefore: 3, spacingIn: 6, rowSpacingIn: 12, sowDepthIn: 1 },
  Leek: { family: 'allium', lifecycle: 'biennial', startIndoorsWeeksBefore: 10, transplantWeeksAfter: -2, spacingIn: 6, rowSpacingIn: 12, sowDepthIn: 0.5 },
  Scallion: { family: 'allium', lifecycle: 'annual', directSowWeeksAfter: -4, spacingIn: 2, rowSpacingIn: 8, sowDepthIn: 0.25, successionDays: 21 },
  Chives: { family: 'allium', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: -2, spacingIn: 8, rowSpacingIn: 12, sowDepthIn: 0.25 },
  'Garlic chives': { family: 'allium', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: -2, spacingIn: 10, rowSpacingIn: 14, sowDepthIn: 0.25 },
  'Walking onion': { family: 'allium', lifecycle: 'perennial', autumnSowWeeksBefore: 4, spacingIn: 8, rowSpacingIn: 14, sowDepthIn: 1 },
  Ramps: { family: 'allium', lifecycle: 'perennial', autumnSowWeeksBefore: 2, spacingIn: 6, rowSpacingIn: 10, sowDepthIn: 1 },

  // ── legumes ────────────────────────────────────────────────────────────────
  'Bush bean': { family: 'legume', lifecycle: 'annual', directSowWeeksAfter: 1, spacingIn: 4, rowSpacingIn: 24, sowDepthIn: 1, successionDays: 14 },
  'Pole bean': { family: 'legume', lifecycle: 'annual', directSowWeeksAfter: 1, spacingIn: 6, rowSpacingIn: 36, sowDepthIn: 1 },
  'Dry bean': { family: 'legume', lifecycle: 'annual', directSowWeeksAfter: 1, spacingIn: 4, rowSpacingIn: 30, sowDepthIn: 1 },
  Pea: { family: 'legume', lifecycle: 'annual', directSowWeeksAfter: -6, spacingIn: 2, rowSpacingIn: 24, sowDepthIn: 1 },
  Cowpea: { family: 'legume', lifecycle: 'annual', directSowWeeksAfter: 2, spacingIn: 4, rowSpacingIn: 30, sowDepthIn: 1 },
  'Fava bean': { family: 'legume', lifecycle: 'annual', directSowWeeksAfter: -6, spacingIn: 6, rowSpacingIn: 24, sowDepthIn: 2 },
  Soybean: { family: 'legume', lifecycle: 'annual', directSowWeeksAfter: 2, spacingIn: 4, rowSpacingIn: 24, sowDepthIn: 1 },
  Peanut: { family: 'legume', lifecycle: 'annual', directSowWeeksAfter: 2, spacingIn: 8, rowSpacingIn: 30, sowDepthIn: 2 },
  Chickpea: { family: 'legume', lifecycle: 'annual', directSowWeeksAfter: -2, spacingIn: 4, rowSpacingIn: 24, sowDepthIn: 2 },
  Lentil: { family: 'legume', lifecycle: 'annual', directSowWeeksAfter: -4, spacingIn: 2, rowSpacingIn: 12, sowDepthIn: 1 },
  Clover: { family: 'legume', lifecycle: 'perennial', directSowWeeksAfter: -4, sowDepthIn: 0.25 },
  Vetch: { family: 'legume', lifecycle: 'annual', autumnSowWeeksBefore: 6, sowDepthIn: 1 },
  'Runner bean': { family: 'legume', lifecycle: 'annual', directSowWeeksAfter: 1, spacingIn: 6, rowSpacingIn: 36, sowDepthIn: 1.5 },
  'Yardlong bean': { family: 'legume', lifecycle: 'annual', directSowWeeksAfter: 2, spacingIn: 6, rowSpacingIn: 36, sowDepthIn: 1 },
  'Sunn hemp': { family: 'legume', lifecycle: 'annual', directSowWeeksAfter: 2, spacingIn: 4, rowSpacingIn: 18, sowDepthIn: 0.5 },

  // ── roots and umbellifers ──────────────────────────────────────────────────
  Carrot: { family: 'umbellifer', lifecycle: 'biennial', directSowWeeksAfter: -3, spacingIn: 2, rowSpacingIn: 12, sowDepthIn: 0.25, successionDays: 21 },
  Parsnip: { family: 'umbellifer', lifecycle: 'biennial', directSowWeeksAfter: -2, spacingIn: 4, rowSpacingIn: 18, sowDepthIn: 0.5 },
  Celeriac: { family: 'umbellifer', lifecycle: 'biennial', startIndoorsWeeksBefore: 10, transplantWeeksAfter: 2, spacingIn: 10, rowSpacingIn: 18, sowDepthIn: 0.25 },
  Celery: { family: 'umbellifer', lifecycle: 'biennial', startIndoorsWeeksBefore: 10, transplantWeeksAfter: 2, spacingIn: 8, rowSpacingIn: 18, sowDepthIn: 0.25 },
  Salsify: { family: 'aster', lifecycle: 'biennial', directSowWeeksAfter: -2, spacingIn: 4, rowSpacingIn: 18, sowDepthIn: 0.5 },
  Beet: { family: 'chenopod', lifecycle: 'biennial', directSowWeeksAfter: -3, spacingIn: 4, rowSpacingIn: 14, sowDepthIn: 0.5, successionDays: 21 },
  Chard: { family: 'chenopod', lifecycle: 'biennial', directSowWeeksAfter: -2, spacingIn: 10, rowSpacingIn: 18, sowDepthIn: 0.5 },
  'Sweet potato': { family: 'other', lifecycle: 'perennial', transplantWeeksAfter: 3, spacingIn: 14, rowSpacingIn: 36, sowDepthIn: 4 },
  Sunchoke: { family: 'aster', lifecycle: 'perennial', directSowWeeksAfter: -2, spacingIn: 18, rowSpacingIn: 36, sowDepthIn: 4 },
  Horseradish: { family: 'brassica', lifecycle: 'perennial', directSowWeeksAfter: -2, spacingIn: 18, rowSpacingIn: 30, sowDepthIn: 4 },
  Mangel: { family: 'chenopod', lifecycle: 'biennial', directSowWeeksAfter: -2, spacingIn: 10, rowSpacingIn: 24, sowDepthIn: 1 },
  Scorzonera: { family: 'aster', lifecycle: 'perennial', directSowWeeksAfter: -2, spacingIn: 4, rowSpacingIn: 18, sowDepthIn: 0.5 },
  Skirret: { family: 'umbellifer', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: -2, spacingIn: 12, rowSpacingIn: 18, sowDepthIn: 0.25 },
  Jicama: { family: 'legume', lifecycle: 'annual', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 3, spacingIn: 8, rowSpacingIn: 36, sowDepthIn: 1 },

  // ── leafy greens ───────────────────────────────────────────────────────────
  Lettuce: { family: 'aster', lifecycle: 'annual', directSowWeeksAfter: -4, spacingIn: 10, rowSpacingIn: 14, sowDepthIn: 0.25, successionDays: 14 },
  Spinach: { family: 'chenopod', lifecycle: 'annual', directSowWeeksAfter: -6, spacingIn: 4, rowSpacingIn: 12, sowDepthIn: 0.5, successionDays: 14 },
  Endive: { family: 'aster', lifecycle: 'annual', directSowWeeksAfter: -3, spacingIn: 10, rowSpacingIn: 14, sowDepthIn: 0.25 },
  Radicchio: { family: 'aster', lifecycle: 'annual', directSowWeeksAfter: 6, spacingIn: 10, rowSpacingIn: 14, sowDepthIn: 0.25 },
  Sorrel: { family: 'other', lifecycle: 'perennial', directSowWeeksAfter: -3, spacingIn: 10, rowSpacingIn: 14, sowDepthIn: 0.25 },
  Mache: { family: 'other', lifecycle: 'annual', autumnSowWeeksBefore: 6, spacingIn: 4, rowSpacingIn: 8, sowDepthIn: 0.25 },
  Claytonia: { family: 'other', lifecycle: 'annual', autumnSowWeeksBefore: 6, spacingIn: 4, rowSpacingIn: 8, sowDepthIn: 0.25 },
  Purslane: { family: 'other', lifecycle: 'annual', directSowWeeksAfter: 2, spacingIn: 6, rowSpacingIn: 12, sowDepthIn: 0.25 },
  Cress: { family: 'brassica', lifecycle: 'annual', directSowWeeksAfter: -4, spacingIn: 4, rowSpacingIn: 8, sowDepthIn: 0.25, successionDays: 10 },
  Orach: { family: 'chenopod', lifecycle: 'annual', directSowWeeksAfter: -2, spacingIn: 10, rowSpacingIn: 18, sowDepthIn: 0.5 },
  'Malabar spinach': { family: 'other', lifecycle: 'annual', startIndoorsWeeksBefore: 6, transplantWeeksAfter: 2, spacingIn: 12, rowSpacingIn: 24, sowDepthIn: 0.5 },
  'New Zealand spinach': { family: 'other', lifecycle: 'annual', directSowWeeksAfter: 1, spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.5 },
  Watercress: { family: 'brassica', lifecycle: 'perennial', directSowWeeksAfter: -2, spacingIn: 6, rowSpacingIn: 10, sowDepthIn: 0.125 },
  'Land cress': { family: 'brassica', lifecycle: 'biennial', directSowWeeksAfter: -4, spacingIn: 6, rowSpacingIn: 10, sowDepthIn: 0.25, successionDays: 14 },
  Dandelion: { family: 'aster', lifecycle: 'perennial', directSowWeeksAfter: -4, spacingIn: 8, rowSpacingIn: 12, sowDepthIn: 0.125 },

  // ── herbs ──────────────────────────────────────────────────────────────────
  Basil: { family: 'other', lifecycle: 'annual', startIndoorsWeeksBefore: 6, transplantWeeksAfter: 2, spacingIn: 10, rowSpacingIn: 18, sowDepthIn: 0.25 },
  Parsley: { family: 'umbellifer', lifecycle: 'biennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: -2, spacingIn: 8, rowSpacingIn: 12, sowDepthIn: 0.25 },
  Cilantro: { family: 'umbellifer', lifecycle: 'annual', directSowWeeksAfter: -3, spacingIn: 4, rowSpacingIn: 10, sowDepthIn: 0.5, successionDays: 14 },
  Dill: { family: 'umbellifer', lifecycle: 'annual', directSowWeeksAfter: -2, spacingIn: 8, rowSpacingIn: 18, sowDepthIn: 0.25, successionDays: 21 },
  Oregano: { family: 'other', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 2, spacingIn: 12, rowSpacingIn: 18, sowDepthIn: 0.25 },
  Thyme: { family: 'other', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 2, spacingIn: 10, rowSpacingIn: 14, sowDepthIn: 0.25 },
  Sage: { family: 'other', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 2, spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.25 },
  Rosemary: { family: 'other', lifecycle: 'perennial', startIndoorsWeeksBefore: 10, transplantWeeksAfter: 3, spacingIn: 24, rowSpacingIn: 30, sowDepthIn: 0.25 },
  Mint: { family: 'other', lifecycle: 'perennial', transplantWeeksAfter: 2, spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.25 },
  Marjoram: { family: 'other', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 2, spacingIn: 10, rowSpacingIn: 14, sowDepthIn: 0.25 },
  Savory: { family: 'other', lifecycle: 'annual', directSowWeeksAfter: 1, spacingIn: 10, rowSpacingIn: 14, sowDepthIn: 0.25 },
  // Summer savory is an annual and winter savory is a woody perennial. Same
  // shelf in the kitchen, different crop in the ground.
  'Winter savory': { family: 'other', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 2, spacingIn: 12, rowSpacingIn: 18, sowDepthIn: 0.125 },
  Tarragon: { family: 'aster', lifecycle: 'perennial', transplantWeeksAfter: 2, spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.25 },
  Chervil: { family: 'umbellifer', lifecycle: 'annual', directSowWeeksAfter: -3, spacingIn: 6, rowSpacingIn: 10, sowDepthIn: 0.25 },
  Lavender: { family: 'other', lifecycle: 'perennial', startIndoorsWeeksBefore: 10, transplantWeeksAfter: 2, spacingIn: 24, rowSpacingIn: 30, sowDepthIn: 0.125 },
  Lemongrass: { family: 'grass', lifecycle: 'perennial', transplantWeeksAfter: 3, spacingIn: 24, rowSpacingIn: 30, sowDepthIn: 0.25 },
  // German chamomile is the annual that reseeds; Roman chamomile is the mat-
  // forming perennial. Both are "chamomile" on a tea label and neither is grown
  // the same way, so they are two crops here.
  Chamomile: { family: 'aster', lifecycle: 'annual', directSowWeeksAfter: -2, spacingIn: 8, rowSpacingIn: 12, sowDepthIn: 0.125 },
  'Roman chamomile': { family: 'aster', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 1, spacingIn: 12, rowSpacingIn: 18, sowDepthIn: 0.125 },
  Calendula: { family: 'aster', lifecycle: 'annual', directSowWeeksAfter: -2, spacingIn: 12, rowSpacingIn: 18, sowDepthIn: 0.25 },
  Echinacea: { family: 'aster', lifecycle: 'perennial', startIndoorsWeeksBefore: 10, transplantWeeksAfter: 2, spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.25 },
  'Lemon balm': { family: 'other', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 2, spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.125 },
  Borage: { family: 'other', lifecycle: 'annual', directSowWeeksAfter: 1, spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.5 },
  Catnip: { family: 'other', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 2, spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.125 },
  Yarrow: { family: 'aster', lifecycle: 'perennial', startIndoorsWeeksBefore: 10, transplantWeeksAfter: 2, spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.125 },
  Comfrey: { family: 'other', lifecycle: 'perennial', transplantWeeksAfter: 2, spacingIn: 30, rowSpacingIn: 36, sowDepthIn: 3 },
  Feverfew: { family: 'aster', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 2, spacingIn: 15, rowSpacingIn: 18, sowDepthIn: 0.125 },
  Valerian: { family: 'other', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 2, spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.125 },
  Tulsi: { family: 'other', lifecycle: 'annual', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 2, spacingIn: 15, rowSpacingIn: 20, sowDepthIn: 0.25 },
  'Milk thistle': { family: 'aster', lifecycle: 'annual', directSowWeeksAfter: -2, spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.5 },
  Ashwagandha: { family: 'solanaceae', lifecycle: 'annual', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 2, spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.25 },
  Stevia: { family: 'aster', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 2, spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.125 },
  "St John's wort": { family: 'other', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 2, spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.125 },
  Plantain: { family: 'other', lifecycle: 'perennial', directSowWeeksAfter: -2, spacingIn: 10, rowSpacingIn: 14, sowDepthIn: 0.125 },
  'Anise hyssop': { family: 'other', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 1, spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.125 },
  Spilanthes: { family: 'aster', lifecycle: 'annual', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 2, spacingIn: 12, rowSpacingIn: 18, sowDepthIn: 0.125 },
  Elecampane: { family: 'aster', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 1, spacingIn: 30, rowSpacingIn: 36, sowDepthIn: 0.125 },
  Skullcap: { family: 'other', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 2, spacingIn: 12, rowSpacingIn: 18, sowDepthIn: 0.125 },
  Motherwort: { family: 'other', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 1, spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.125 },
  Astragalus: { family: 'legume', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 1, spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.5 },
  Arnica: { family: 'aster', lifecycle: 'perennial', startIndoorsWeeksBefore: 10, transplantWeeksAfter: 1, spacingIn: 12, rowSpacingIn: 18, sowDepthIn: 0.125 },
  Marshmallow: { family: 'other', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 1, spacingIn: 24, rowSpacingIn: 36, sowDepthIn: 0.25 },
  Ginseng: { family: 'other', lifecycle: 'perennial', autumnSowWeeksBefore: 2, spacingIn: 6, rowSpacingIn: 12, sowDepthIn: 0.5 },
  'Bay laurel': { family: 'other', lifecycle: 'perennial', transplantWeeksAfter: 3, spacingIn: 48, rowSpacingIn: 72, sowDepthIn: 0.5 },

  // ── cut flowers ────────────────────────────────────────────────────────────
  Zinnia: { family: 'aster', lifecycle: 'annual', directSowWeeksAfter: 1, spacingIn: 12, rowSpacingIn: 18, sowDepthIn: 0.25, successionDays: 21 },
  Sunflower: { family: 'aster', lifecycle: 'annual', directSowWeeksAfter: 1, spacingIn: 12, rowSpacingIn: 24, sowDepthIn: 1, successionDays: 14 },
  Cosmos: { family: 'aster', lifecycle: 'annual', directSowWeeksAfter: 1, spacingIn: 12, rowSpacingIn: 18, sowDepthIn: 0.25 },
  Celosia: { family: 'other', lifecycle: 'annual', startIndoorsWeeksBefore: 6, transplantWeeksAfter: 2, spacingIn: 10, rowSpacingIn: 14, sowDepthIn: 0.125 },
  Gomphrena: { family: 'other', lifecycle: 'annual', startIndoorsWeeksBefore: 6, transplantWeeksAfter: 2, spacingIn: 10, rowSpacingIn: 14, sowDepthIn: 0.125 },
  Strawflower: { family: 'aster', lifecycle: 'annual', startIndoorsWeeksBefore: 6, transplantWeeksAfter: 1, spacingIn: 10, rowSpacingIn: 14, sowDepthIn: 0.125 },
  Statice: { family: 'other', lifecycle: 'annual', startIndoorsWeeksBefore: 8, transplantWeeksAfter: -2, spacingIn: 9, rowSpacingIn: 12, sowDepthIn: 0.125 },
  Snapdragon: { family: 'other', lifecycle: 'annual', startIndoorsWeeksBefore: 10, transplantWeeksAfter: -3, spacingIn: 8, rowSpacingIn: 12, sowDepthIn: 0.125 },
  Nigella: { family: 'other', lifecycle: 'annual', directSowWeeksAfter: -4, spacingIn: 8, rowSpacingIn: 12, sowDepthIn: 0.25 },
  Cornflower: { family: 'aster', lifecycle: 'annual', directSowWeeksAfter: -4, spacingIn: 8, rowSpacingIn: 12, sowDepthIn: 0.25 },
  'Sweet pea': { family: 'legume', lifecycle: 'annual', directSowWeeksAfter: -6, spacingIn: 6, rowSpacingIn: 24, sowDepthIn: 1 },
  Amaranth: { family: 'chenopod', lifecycle: 'annual', directSowWeeksAfter: 1, spacingIn: 12, rowSpacingIn: 24, sowDepthIn: 0.125 },
  Poppy: { family: 'other', lifecycle: 'annual', directSowWeeksAfter: -6, spacingIn: 8, rowSpacingIn: 12, sowDepthIn: 0.125 },
  Larkspur: { family: 'other', lifecycle: 'annual', directSowWeeksAfter: -6, spacingIn: 8, rowSpacingIn: 12, sowDepthIn: 0.125 },
  Rudbeckia: { family: 'aster', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: 1, spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.125 },
  Dianthus: { family: 'other', lifecycle: 'perennial', startIndoorsWeeksBefore: 8, transplantWeeksAfter: -2, spacingIn: 10, rowSpacingIn: 14, sowDepthIn: 0.125 },
  Liatris: { family: 'aster', lifecycle: 'perennial', directSowWeeksAfter: -2, spacingIn: 8, rowSpacingIn: 12, sowDepthIn: 2 },
  Milkweed: { family: 'other', lifecycle: 'perennial', directSowWeeksAfter: -4, spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.25 },
  Dahlia: { family: 'aster', lifecycle: 'perennial', directSowWeeksAfter: 1, spacingIn: 18, rowSpacingIn: 30, sowDepthIn: 5 },
  Gladiolus: { family: 'other', lifecycle: 'perennial', directSowWeeksAfter: 0, spacingIn: 6, rowSpacingIn: 12, sowDepthIn: 5, successionDays: 14 },
  'California poppy': { family: 'other', lifecycle: 'annual', directSowWeeksAfter: -6, spacingIn: 8, rowSpacingIn: 12, sowDepthIn: 0.125 },
  // Autumn-planted bulbs and roots. They anchor to first frost rather than
  // last, which is the whole reason `autumnSowWeeksBefore` exists.
  Peony: { family: 'other', lifecycle: 'perennial', autumnSowWeeksBefore: 6, spacingIn: 36, rowSpacingIn: 48, sowDepthIn: 2 },
  Tulip: { family: 'other', lifecycle: 'perennial', autumnSowWeeksBefore: 4, spacingIn: 5, rowSpacingIn: 8, sowDepthIn: 6 },
  Daffodil: { family: 'other', lifecycle: 'perennial', autumnSowWeeksBefore: 6, spacingIn: 6, rowSpacingIn: 10, sowDepthIn: 6 },
  'Ornamental allium': { family: 'allium', lifecycle: 'perennial', autumnSowWeeksBefore: 4, spacingIn: 8, rowSpacingIn: 12, sowDepthIn: 6 },
  Ranunculus: { family: 'other', lifecycle: 'perennial', autumnSowWeeksBefore: 8, spacingIn: 9, rowSpacingIn: 12, sowDepthIn: 2 },
  Anemone: { family: 'other', lifecycle: 'perennial', autumnSowWeeksBefore: 8, spacingIn: 9, rowSpacingIn: 12, sowDepthIn: 2 },

  // ── grains and cover crops ─────────────────────────────────────────────────
  'Sweet corn': { family: 'grass', lifecycle: 'annual', directSowWeeksAfter: 1, spacingIn: 10, rowSpacingIn: 30, sowDepthIn: 1.5, successionDays: 14 },
  'Dent corn': { family: 'grass', lifecycle: 'annual', directSowWeeksAfter: 1, spacingIn: 10, rowSpacingIn: 36, sowDepthIn: 1.5 },
  'Flint corn': { family: 'grass', lifecycle: 'annual', directSowWeeksAfter: 1, spacingIn: 10, rowSpacingIn: 36, sowDepthIn: 1.5 },
  Popcorn: { family: 'grass', lifecycle: 'annual', directSowWeeksAfter: 1, spacingIn: 8, rowSpacingIn: 30, sowDepthIn: 1.5 },
  Wheat: { family: 'grass', lifecycle: 'annual', autumnSowWeeksBefore: 6, spacingIn: 2, rowSpacingIn: 7, sowDepthIn: 1.5 },
  Barley: { family: 'grass', lifecycle: 'annual', directSowWeeksAfter: -6, spacingIn: 2, rowSpacingIn: 7, sowDepthIn: 1.5 },
  Oats: { family: 'grass', lifecycle: 'annual', directSowWeeksAfter: -6, spacingIn: 2, rowSpacingIn: 7, sowDepthIn: 1 },
  Rye: { family: 'grass', lifecycle: 'annual', autumnSowWeeksBefore: 4, spacingIn: 2, rowSpacingIn: 7, sowDepthIn: 1 },
  Triticale: { family: 'grass', lifecycle: 'annual', autumnSowWeeksBefore: 6, spacingIn: 2, rowSpacingIn: 7, sowDepthIn: 1.5 },
  Sorghum: { family: 'grass', lifecycle: 'annual', directSowWeeksAfter: 2, spacingIn: 6, rowSpacingIn: 30, sowDepthIn: 1 },
  Buckwheat: { family: 'other', lifecycle: 'annual', directSowWeeksAfter: 1, spacingIn: 3, rowSpacingIn: 12, sowDepthIn: 0.75, successionDays: 21 },
  Quinoa: { family: 'chenopod', lifecycle: 'annual', directSowWeeksAfter: -2, spacingIn: 12, rowSpacingIn: 24, sowDepthIn: 0.25 },
  Millet: { family: 'grass', lifecycle: 'annual', directSowWeeksAfter: 2, spacingIn: 4, rowSpacingIn: 18, sowDepthIn: 0.75 },
  Teff: { family: 'grass', lifecycle: 'annual', directSowWeeksAfter: 2, spacingIn: 2, rowSpacingIn: 8, sowDepthIn: 0.125 },
  Sesame: { family: 'other', lifecycle: 'annual', directSowWeeksAfter: 2, spacingIn: 4, rowSpacingIn: 24, sowDepthIn: 0.5 },
  Flax: { family: 'other', lifecycle: 'annual', directSowWeeksAfter: -4, spacingIn: 2, rowSpacingIn: 7, sowDepthIn: 0.5 },
  'Flour corn': { family: 'grass', lifecycle: 'annual', directSowWeeksAfter: 1, spacingIn: 10, rowSpacingIn: 36, sowDepthIn: 1.5 },
  Spelt: { family: 'grass', lifecycle: 'annual', autumnSowWeeksBefore: 6, spacingIn: 2, rowSpacingIn: 7, sowDepthIn: 1.5 },
  Einkorn: { family: 'grass', lifecycle: 'annual', autumnSowWeeksBefore: 6, spacingIn: 2, rowSpacingIn: 7, sowDepthIn: 1 },
  Emmer: { family: 'grass', lifecycle: 'annual', autumnSowWeeksBefore: 6, spacingIn: 2, rowSpacingIn: 7, sowDepthIn: 1.5 },
  'Wild rice': { family: 'grass', lifecycle: 'annual', directSowWeeksAfter: -2, spacingIn: 12, rowSpacingIn: 24, sowDepthIn: 1 },
  Hemp: { family: 'other', lifecycle: 'annual', directSowWeeksAfter: 1, spacingIn: 6, rowSpacingIn: 30, sowDepthIn: 0.75 },
};

/**
 * A crop's defaults, however it was capitalised.
 *
 * Used by the library factory below and by the add-your-own form, which is the
 * point: a farm typing a crop the library already knows gets its timing without
 * being asked for any of it.
 */
export function cropDefaults(crop: string): CropDefaults | undefined {
  const wanted = crop.trim().toLowerCase();
  for (const [name, defaults] of Object.entries(CROP_DEFAULTS)) {
    if (name.toLowerCase() === wanted) return defaults;
  }
  return undefined;
}

/**
 * A cultivar, as the shortest thing that can be written down: a name and how
 * long it takes. Everything else comes from the crop.
 */
export type Cultivar = readonly [name: string, daysToMaturity: number, note?: string];

/**
 * Expands the compact tables into the shape the library ships.
 *
 * Slugged from the crop and the name so an id is stable and readable, and
 * `custom: false` is implied by being here at all — this is what shipped.
 */
export function expand(
  crop: string,
  cultivars: readonly Cultivar[],
): LibraryVariety[] {
  const defaults = cropDefaults(crop);
  if (defaults === undefined) throw new Error(`No crop defaults for "${crop}"`);

  const slug = (s: string): string =>
    s
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  return cultivars.map(([name, daysToMaturity, note]) => ({
    id: `${slug(crop)}-${slug(name)}`,
    crop,
    name,
    daysToMaturity,
    ...defaults,
    ...(note === undefined ? {} : { note }),
    provenance: 'commonly-published' as const,
  }));
}
