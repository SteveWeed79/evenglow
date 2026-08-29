import { CATALOGUE_VARIETIES } from './cultivars';
import type { LibraryVariety } from './types';

/**
 * Sixty-odd vegetables, herbs and fruit a small farm actually grows.
 *
 * Authored in inches and weeks because those are checkable by eye against a
 * seed catalogue; the factory converts. Timing is anchored to last spring
 * frost throughout, except the autumn-sown crops which anchor to first frost.
 *
 * Nothing here is exhaustive and nothing here is authoritative. It exists so
 * the first evening with the app is useful rather than an evening of typing.
 *
 * ## These are hand-tuned, and they win
 *
 * The bulk of the library now comes from `cultivars.ts`, where a cultivar is a
 * name and a number and everything else is inherited from the crop. The entries
 * below predate that and were written one at a time, so several carry a figure
 * or a note that the crop's defaults would flatten. Where the two describe the
 * same variety, these are kept and the generated one is dropped — see the merge
 * at the foot of the file.
 */

const P = 'commonly-published' as const;

const HAND_TUNED: readonly LibraryVariety[] = [
  // ── solanaceae ─────────────────────────────────────────────────────────────
  { id: 'tomato-sungold', crop: 'Tomato', name: 'Sungold', family: 'solanaceae', lifecycle: 'annual',
    startIndoorsWeeksBefore: 6, transplantWeeksAfter: 2, daysToMaturity: 57,
    spacingIn: 24, rowSpacingIn: 48, sowDepthIn: 0.25, provenance: P,
    note: 'Cherry. Indeterminate — needs staking and keeps going until frost.' },
  { id: 'tomato-roma', crop: 'Tomato', name: 'Roma', family: 'solanaceae', lifecycle: 'annual',
    startIndoorsWeeksBefore: 6, transplantWeeksAfter: 2, daysToMaturity: 75,
    spacingIn: 24, rowSpacingIn: 36, sowDepthIn: 0.25, provenance: P,
    note: 'Paste. Determinate — ripens in a block, which is what you want for sauce.' },
  { id: 'tomato-brandywine', crop: 'Tomato', name: 'Brandywine', family: 'solanaceae', lifecycle: 'annual',
    startIndoorsWeeksBefore: 7, transplantWeeksAfter: 2, daysToMaturity: 85,
    spacingIn: 30, rowSpacingIn: 48, sowDepthIn: 0.25, provenance: P },
  { id: 'tomato-cherokee-purple', crop: 'Tomato', name: 'Cherokee Purple', family: 'solanaceae', lifecycle: 'annual',
    startIndoorsWeeksBefore: 6, transplantWeeksAfter: 2, daysToMaturity: 80,
    spacingIn: 24, rowSpacingIn: 48, sowDepthIn: 0.25, provenance: P },
  { id: 'pepper-california-wonder', crop: 'Pepper', name: 'California Wonder', family: 'solanaceae', lifecycle: 'annual',
    startIndoorsWeeksBefore: 8, transplantWeeksAfter: 3, daysToMaturity: 75,
    spacingIn: 18, rowSpacingIn: 30, sowDepthIn: 0.25, provenance: P,
    note: 'Peppers want warm soil — going out early costs more than it gains.' },
  { id: 'pepper-jalapeno', crop: 'Pepper', name: 'Jalapeño', family: 'solanaceae', lifecycle: 'annual',
    startIndoorsWeeksBefore: 8, transplantWeeksAfter: 3, daysToMaturity: 70,
    spacingIn: 18, rowSpacingIn: 30, sowDepthIn: 0.25, provenance: P },
  { id: 'eggplant-black-beauty', crop: 'Eggplant', name: 'Black Beauty', family: 'solanaceae', lifecycle: 'annual',
    startIndoorsWeeksBefore: 8, transplantWeeksAfter: 3, daysToMaturity: 80,
    spacingIn: 24, rowSpacingIn: 36, sowDepthIn: 0.25, provenance: P },
  { id: 'potato-yukon-gold', crop: 'Potato', name: 'Yukon Gold', family: 'solanaceae', lifecycle: 'annual',
    directSowWeeksAfter: -3, daysToMaturity: 90, spacingIn: 12, rowSpacingIn: 32, sowDepthIn: 4, provenance: P,
    note: 'Seed potatoes, not seed. Goes in before last frost — the shoots come up after it.' },
  { id: 'potato-kennebec', crop: 'Potato', name: 'Kennebec', family: 'solanaceae', lifecycle: 'annual',
    directSowWeeksAfter: -3, daysToMaturity: 105, spacingIn: 12, rowSpacingIn: 32, sowDepthIn: 4, provenance: P },
  { id: 'tomatillo-toma-verde', crop: 'Tomatillo', name: 'Toma Verde', family: 'solanaceae', lifecycle: 'annual',
    startIndoorsWeeksBefore: 6, transplantWeeksAfter: 2, daysToMaturity: 70,
    spacingIn: 30, rowSpacingIn: 48, sowDepthIn: 0.25, provenance: P,
    note: 'Needs two plants to set fruit at all.' },

  // ── brassica ───────────────────────────────────────────────────────────────
  { id: 'kale-lacinato', crop: 'Kale', name: 'Lacinato', family: 'brassica', lifecycle: 'biennial',
    startIndoorsWeeksBefore: 6, transplantWeeksAfter: -2, daysToMaturity: 60,
    spacingIn: 12, rowSpacingIn: 24, sowDepthIn: 0.5, provenance: P,
    note: 'Sweeter after a frost, so the autumn planting is the better one.' },
  { id: 'kale-red-russian', crop: 'Kale', name: 'Red Russian', family: 'brassica', lifecycle: 'biennial',
    startIndoorsWeeksBefore: 6, transplantWeeksAfter: -2, daysToMaturity: 50,
    spacingIn: 12, rowSpacingIn: 24, sowDepthIn: 0.5, provenance: P },
  { id: 'broccoli-calabrese', crop: 'Broccoli', name: 'Calabrese', family: 'brassica', lifecycle: 'annual',
    startIndoorsWeeksBefore: 6, transplantWeeksAfter: -2, daysToMaturity: 65,
    spacingIn: 18, rowSpacingIn: 30, sowDepthIn: 0.5, provenance: P },
  { id: 'cabbage-golden-acre', crop: 'Cabbage', name: 'Golden Acre', family: 'brassica', lifecycle: 'biennial',
    startIndoorsWeeksBefore: 6, transplantWeeksAfter: -3, daysToMaturity: 65,
    spacingIn: 15, rowSpacingIn: 30, sowDepthIn: 0.5, provenance: P },
  { id: 'cauliflower-snowball', crop: 'Cauliflower', name: 'Snowball', family: 'brassica', lifecycle: 'annual',
    startIndoorsWeeksBefore: 6, transplantWeeksAfter: -2, daysToMaturity: 70,
    spacingIn: 18, rowSpacingIn: 30, sowDepthIn: 0.5, provenance: P },
  { id: 'brussels-long-island', crop: 'Brussels sprouts', name: 'Long Island Improved', family: 'brassica', lifecycle: 'annual',
    startIndoorsWeeksBefore: 6, transplantWeeksAfter: 0, daysToMaturity: 100,
    spacingIn: 24, rowSpacingIn: 30, sowDepthIn: 0.5, provenance: P,
    note: 'Long season. Sprouts are worth eating only after a hard frost.' },
  { id: 'kohlrabi-early-white', crop: 'Kohlrabi', name: 'Early White Vienna', family: 'brassica', lifecycle: 'biennial',
    directSowWeeksAfter: -2, daysToMaturity: 55, spacingIn: 6, rowSpacingIn: 18, sowDepthIn: 0.5,
    successionDays: 21, provenance: P },
  { id: 'radish-cherry-belle', crop: 'Radish', name: 'Cherry Belle', family: 'brassica', lifecycle: 'annual',
    directSowWeeksAfter: -4, daysToMaturity: 24, spacingIn: 2, rowSpacingIn: 12, sowDepthIn: 0.5,
    successionDays: 10, provenance: P,
    note: 'The fastest thing in the garden, and the best succession crop there is.' },
  { id: 'turnip-purple-top', crop: 'Turnip', name: 'Purple Top White Globe', family: 'brassica', lifecycle: 'biennial',
    directSowWeeksAfter: -3, daysToMaturity: 55, spacingIn: 4, rowSpacingIn: 18, sowDepthIn: 0.5, provenance: P },
  { id: 'arugula-rocket', crop: 'Arugula', name: 'Rocket', family: 'brassica', lifecycle: 'annual',
    directSowWeeksAfter: -4, daysToMaturity: 40, spacingIn: 4, rowSpacingIn: 12, sowDepthIn: 0.25,
    successionDays: 14, provenance: P },
  { id: 'mustard-southern-giant', crop: 'Mustard greens', name: 'Southern Giant Curled', family: 'brassica', lifecycle: 'annual',
    directSowWeeksAfter: -3, daysToMaturity: 45, spacingIn: 6, rowSpacingIn: 18, sowDepthIn: 0.5,
    successionDays: 21, provenance: P },
  { id: 'collards-georgia', crop: 'Collards', name: 'Georgia Southern', family: 'brassica', lifecycle: 'biennial',
    startIndoorsWeeksBefore: 6, transplantWeeksAfter: -2, daysToMaturity: 75,
    spacingIn: 18, rowSpacingIn: 30, sowDepthIn: 0.5, provenance: P },

  // ── cucurbit ───────────────────────────────────────────────────────────────
  { id: 'cucumber-marketmore-76', crop: 'Cucumber', name: 'Marketmore 76', family: 'cucurbit', lifecycle: 'annual',
    directSowWeeksAfter: 2, daysToMaturity: 58, spacingIn: 12, rowSpacingIn: 60, sowDepthIn: 1,
    successionDays: 21, provenance: P },
  { id: 'zucchini-black-beauty', crop: 'Zucchini', name: 'Black Beauty', family: 'cucurbit', lifecycle: 'annual',
    directSowWeeksAfter: 2, daysToMaturity: 50, spacingIn: 24, rowSpacingIn: 48, sowDepthIn: 1, provenance: P,
    note: 'Two plants feed a household. Three feeds a neighbourhood.' },
  { id: 'squash-yellow-crookneck', crop: 'Summer squash', name: 'Yellow Crookneck', family: 'cucurbit', lifecycle: 'annual',
    directSowWeeksAfter: 2, daysToMaturity: 53, spacingIn: 24, rowSpacingIn: 48, sowDepthIn: 1, provenance: P },
  { id: 'squash-waltham-butternut', crop: 'Winter squash', name: 'Waltham Butternut', family: 'cucurbit', lifecycle: 'annual',
    directSowWeeksAfter: 2, daysToMaturity: 105, spacingIn: 36, rowSpacingIn: 72, sowDepthIn: 1, provenance: P,
    note: 'Stores until spring in a cool room, which is most of the point.' },
  { id: 'pumpkin-sugar-pie', crop: 'Pumpkin', name: 'Sugar Pie', family: 'cucurbit', lifecycle: 'annual',
    directSowWeeksAfter: 2, daysToMaturity: 100, spacingIn: 36, rowSpacingIn: 72, sowDepthIn: 1, provenance: P },
  { id: 'watermelon-sugar-baby', crop: 'Watermelon', name: 'Sugar Baby', family: 'cucurbit', lifecycle: 'annual',
    startIndoorsWeeksBefore: 3, transplantWeeksAfter: 2, daysToMaturity: 80,
    spacingIn: 36, rowSpacingIn: 72, sowDepthIn: 1, provenance: P,
    note: 'Wants a long warm season; a short one is beaten with black plastic and transplants.' },
  { id: 'melon-hales-best', crop: 'Cantaloupe', name: "Hale's Best Jumbo", family: 'cucurbit', lifecycle: 'annual',
    startIndoorsWeeksBefore: 3, transplantWeeksAfter: 2, daysToMaturity: 85,
    spacingIn: 24, rowSpacingIn: 60, sowDepthIn: 1, provenance: P },

  // ── allium ─────────────────────────────────────────────────────────────────
  { id: 'onion-yellow-spanish', crop: 'Onion', name: 'Yellow Sweet Spanish', family: 'allium', lifecycle: 'biennial',
    startIndoorsWeeksBefore: 10, transplantWeeksAfter: -4, daysToMaturity: 110,
    spacingIn: 4, rowSpacingIn: 15, sowDepthIn: 0.25, provenance: P,
    note: 'Day length decides bulbing, not the calendar — check long-day or short-day for your latitude.' },
  { id: 'garlic-music', crop: 'Garlic', name: 'Music (hardneck)', family: 'allium', lifecycle: 'biennial',
    autumnSowWeeksBefore: 3, daysToMaturity: 240, spacingIn: 6, rowSpacingIn: 12, sowDepthIn: 2, provenance: P,
    note: 'Autumn-planted. Has no spring anchor at all — it wants a cold period to split into cloves.' },
  { id: 'leek-american-flag', crop: 'Leek', name: 'American Flag', family: 'allium', lifecycle: 'biennial',
    startIndoorsWeeksBefore: 10, transplantWeeksAfter: -2, daysToMaturity: 120,
    spacingIn: 6, rowSpacingIn: 18, sowDepthIn: 0.25, provenance: P },
  { id: 'shallot-french-red', crop: 'Shallot', name: 'French Red', family: 'allium', lifecycle: 'biennial',
    autumnSowWeeksBefore: 3, daysToMaturity: 210, spacingIn: 6, rowSpacingIn: 12, sowDepthIn: 1, provenance: P },
  { id: 'scallion-evergreen', crop: 'Scallion', name: 'Evergreen Hardy White', family: 'allium', lifecycle: 'perennial',
    hardyToF: -20, directSowWeeksAfter: -4, daysToMaturity: 60,
    spacingIn: 2, rowSpacingIn: 12, sowDepthIn: 0.25, successionDays: 21, provenance: P },

  // ── legume ─────────────────────────────────────────────────────────────────
  { id: 'bean-provider', crop: 'Bush bean', name: 'Provider', family: 'legume', lifecycle: 'annual',
    directSowWeeksAfter: 1, daysToMaturity: 50, spacingIn: 3, rowSpacingIn: 24, sowDepthIn: 1,
    successionDays: 14, provenance: P },
  { id: 'bean-kentucky-wonder', crop: 'Pole bean', name: 'Kentucky Wonder', family: 'legume', lifecycle: 'annual',
    directSowWeeksAfter: 1, daysToMaturity: 65, spacingIn: 6, rowSpacingIn: 36, sowDepthIn: 1, provenance: P,
    note: 'Wants something to climb before it needs it, not after.' },
  { id: 'pea-sugar-snap', crop: 'Snap pea', name: 'Sugar Snap', family: 'legume', lifecycle: 'annual',
    directSowWeeksAfter: -5, daysToMaturity: 62, spacingIn: 2, rowSpacingIn: 24, sowDepthIn: 1, provenance: P,
    note: 'As early as the ground can be worked. Heat ends them, not cold.' },
  { id: 'pea-green-arrow', crop: 'Shelling pea', name: 'Green Arrow', family: 'legume', lifecycle: 'annual',
    directSowWeeksAfter: -5, daysToMaturity: 68, spacingIn: 2, rowSpacingIn: 24, sowDepthIn: 1, provenance: P },
  { id: 'edamame-midori-giant', crop: 'Edamame', name: 'Midori Giant', family: 'legume', lifecycle: 'annual',
    directSowWeeksAfter: 1, daysToMaturity: 75, spacingIn: 4, rowSpacingIn: 24, sowDepthIn: 1, provenance: P },
  { id: 'fava-windsor', crop: 'Fava bean', name: 'Broad Windsor', family: 'legume', lifecycle: 'annual',
    directSowWeeksAfter: -6, daysToMaturity: 85, spacingIn: 6, rowSpacingIn: 24, sowDepthIn: 2, provenance: P },

  // ── umbellifer ─────────────────────────────────────────────────────────────
  { id: 'carrot-danvers-126', crop: 'Carrot', name: 'Danvers 126', family: 'umbellifer', lifecycle: 'biennial',
    directSowWeeksAfter: -3, daysToMaturity: 70, spacingIn: 2, rowSpacingIn: 16, sowDepthIn: 0.25,
    successionDays: 21, provenance: P,
    note: 'Slow to germinate and easily lost to a dry week — keep the surface damp.' },
  { id: 'parsnip-hollow-crown', crop: 'Parsnip', name: 'Hollow Crown', family: 'umbellifer', lifecycle: 'biennial',
    directSowWeeksAfter: -2, daysToMaturity: 120, spacingIn: 4, rowSpacingIn: 18, sowDepthIn: 0.5, provenance: P,
    note: 'Leave it in the ground through a frost; that is when it sweetens.' },
  { id: 'celery-tall-utah', crop: 'Celery', name: 'Tall Utah', family: 'umbellifer', lifecycle: 'biennial',
    startIndoorsWeeksBefore: 10, transplantWeeksAfter: 2, daysToMaturity: 100,
    spacingIn: 8, rowSpacingIn: 24, sowDepthIn: 0.125, provenance: P },
  { id: 'dill-bouquet', crop: 'Dill', name: 'Bouquet', family: 'umbellifer', lifecycle: 'annual',
    directSowWeeksAfter: 0, daysToMaturity: 45, spacingIn: 8, rowSpacingIn: 18, sowDepthIn: 0.25,
    successionDays: 21, provenance: P },
  { id: 'cilantro-santo', crop: 'Cilantro', name: 'Santo', family: 'umbellifer', lifecycle: 'annual',
    directSowWeeksAfter: -2, daysToMaturity: 50, spacingIn: 4, rowSpacingIn: 12, sowDepthIn: 0.5,
    successionDays: 14, provenance: P,
    note: 'Bolts in heat. Succession is the only way to have it all summer.' },
  { id: 'parsley-italian-flat', crop: 'Parsley', name: 'Italian Flat Leaf', family: 'umbellifer', lifecycle: 'biennial',
    startIndoorsWeeksBefore: 8, transplantWeeksAfter: -2, daysToMaturity: 75,
    spacingIn: 8, rowSpacingIn: 18, sowDepthIn: 0.25, provenance: P },
  { id: 'fennel-florence', crop: 'Fennel', name: 'Florence', family: 'umbellifer', lifecycle: 'annual',
    directSowWeeksAfter: 2, daysToMaturity: 80, spacingIn: 8, rowSpacingIn: 18, sowDepthIn: 0.25, provenance: P },

  // ── chenopod ───────────────────────────────────────────────────────────────
  { id: 'beet-detroit-dark-red', crop: 'Beet', name: 'Detroit Dark Red', family: 'chenopod', lifecycle: 'biennial',
    directSowWeeksAfter: -4, daysToMaturity: 58, spacingIn: 3, rowSpacingIn: 16, sowDepthIn: 0.5,
    successionDays: 21, provenance: P },
  { id: 'chard-fordhook-giant', crop: 'Swiss chard', name: 'Fordhook Giant', family: 'chenopod', lifecycle: 'biennial',
    directSowWeeksAfter: -2, daysToMaturity: 55, spacingIn: 8, rowSpacingIn: 18, sowDepthIn: 0.5, provenance: P,
    note: 'Cut and come again all season — one sowing does the year.' },
  { id: 'spinach-bloomsdale', crop: 'Spinach', name: 'Bloomsdale Long Standing', family: 'chenopod', lifecycle: 'annual',
    directSowWeeksAfter: -6, daysToMaturity: 45, spacingIn: 4, rowSpacingIn: 12, sowDepthIn: 0.5,
    successionDays: 14, provenance: P },

  // ── aster ──────────────────────────────────────────────────────────────────
  { id: 'lettuce-buttercrunch', crop: 'Lettuce', name: 'Buttercrunch', family: 'aster', lifecycle: 'annual',
    directSowWeeksAfter: -4, daysToMaturity: 55, spacingIn: 8, rowSpacingIn: 12, sowDepthIn: 0.125,
    successionDays: 14, provenance: P },
  { id: 'lettuce-parris-island', crop: 'Lettuce', name: 'Parris Island Cos', family: 'aster', lifecycle: 'annual',
    directSowWeeksAfter: -4, daysToMaturity: 68, spacingIn: 10, rowSpacingIn: 12, sowDepthIn: 0.125,
    successionDays: 14, provenance: P },
  { id: 'endive-broadleaf', crop: 'Endive', name: 'Broadleaf Batavian', family: 'aster', lifecycle: 'annual',
    directSowWeeksAfter: -2, daysToMaturity: 85, spacingIn: 10, rowSpacingIn: 18, sowDepthIn: 0.25, provenance: P },
  { id: 'sunflower-mammoth', crop: 'Sunflower', name: 'Mammoth Grey Stripe', family: 'aster', lifecycle: 'annual',
    directSowWeeksAfter: 1, daysToMaturity: 90, spacingIn: 18, rowSpacingIn: 30, sowDepthIn: 1, provenance: P },
  { id: 'artichoke-green-globe', crop: 'Artichoke', name: 'Green Globe', family: 'aster', lifecycle: 'perennial',
    hardyToF: 15, startIndoorsWeeksBefore: 8, transplantWeeksAfter: 0, daysToMaturity: 180,
    spacingIn: 48, rowSpacingIn: 60, sowDepthIn: 0.25, provenance: P,
    note: 'Perennial where winters are mild; grown as an annual where they are not.' },

  // ── grass ──────────────────────────────────────────────────────────────────
  { id: 'corn-golden-bantam', crop: 'Sweet corn', name: 'Golden Bantam', family: 'grass', lifecycle: 'annual',
    directSowWeeksAfter: 1, daysToMaturity: 78, spacingIn: 10, rowSpacingIn: 30, sowDepthIn: 1.5,
    successionDays: 14, provenance: P,
    note: 'Wind-pollinated: plant a block of short rows, never one long one.' },

  // ── perennials, herbs and fruit ────────────────────────────────────────────
  { id: 'asparagus-mary-washington', crop: 'Asparagus', name: 'Mary Washington', family: 'other', lifecycle: 'perennial',
    hardyToF: -30, directSowWeeksAfter: -2, daysToMaturity: 730,
    spacingIn: 18, rowSpacingIn: 48, sowDepthIn: 6, provenance: P,
    note: 'Crowns, and no cutting for two years. It then holds the bed for twenty.' },
  { id: 'rhubarb-victoria', crop: 'Rhubarb', name: 'Victoria', family: 'other', lifecycle: 'perennial',
    hardyToF: -30, directSowWeeksAfter: -3, daysToMaturity: 365,
    spacingIn: 36, rowSpacingIn: 48, sowDepthIn: 2, provenance: P },
  { id: 'strawberry-ozark-beauty', crop: 'Strawberry', name: 'Ozark Beauty', family: 'other', lifecycle: 'perennial',
    hardyToF: -25, directSowWeeksAfter: -3, daysToMaturity: 120,
    spacingIn: 15, rowSpacingIn: 36, provenance: P,
    note: 'Everbearing. Pinch the first year’s flowers and the second year pays for it.' },
  { id: 'raspberry-heritage', crop: 'Raspberry', name: 'Heritage', family: 'other', lifecycle: 'perennial',
    hardyToF: -30, directSowWeeksAfter: -4, daysToMaturity: 365,
    spacingIn: 24, rowSpacingIn: 96, provenance: P },
  { id: 'blueberry-bluecrop', crop: 'Blueberry', name: 'Bluecrop', family: 'other', lifecycle: 'perennial',
    hardyToF: -25, directSowWeeksAfter: -4, daysToMaturity: 730,
    spacingIn: 60, rowSpacingIn: 96, provenance: P,
    note: 'Wants acid soil — pH 4.5 to 5.5 — and will sulk for years without it.' },
  { id: 'blackberry-triple-crown', crop: 'Blackberry', name: 'Triple Crown', family: 'other', lifecycle: 'perennial',
    hardyToF: -10, directSowWeeksAfter: -4, daysToMaturity: 365,
    spacingIn: 48, rowSpacingIn: 96, provenance: P },
  { id: 'horseradish-common', crop: 'Horseradish', name: 'Common', family: 'brassica', lifecycle: 'perennial',
    hardyToF: -30, directSowWeeksAfter: -3, daysToMaturity: 180,
    spacingIn: 24, rowSpacingIn: 36, sowDepthIn: 4, provenance: P,
    note: 'Put it where you are content for it to stay. It will.' },
  { id: 'basil-genovese', crop: 'Basil', name: 'Genovese', family: 'other', lifecycle: 'annual',
    startIndoorsWeeksBefore: 6, transplantWeeksAfter: 2, daysToMaturity: 68,
    spacingIn: 10, rowSpacingIn: 18, sowDepthIn: 0.25, provenance: P,
    note: 'Killed by the first cold night, not by the first frost.' },
  { id: 'oregano-greek', crop: 'Oregano', name: 'Greek', family: 'other', lifecycle: 'perennial',
    hardyToF: -20, startIndoorsWeeksBefore: 8, transplantWeeksAfter: 1, daysToMaturity: 90,
    spacingIn: 12, rowSpacingIn: 18, sowDepthIn: 0.125, provenance: P },
  { id: 'thyme-english', crop: 'Thyme', name: 'English', family: 'other', lifecycle: 'perennial',
    hardyToF: -20, startIndoorsWeeksBefore: 8, transplantWeeksAfter: 1, daysToMaturity: 90,
    spacingIn: 12, rowSpacingIn: 18, sowDepthIn: 0.125, provenance: P },
  { id: 'rosemary-arp', crop: 'Rosemary', name: 'Arp', family: 'other', lifecycle: 'perennial',
    hardyToF: -10, startIndoorsWeeksBefore: 10, transplantWeeksAfter: 2, daysToMaturity: 180,
    spacingIn: 24, rowSpacingIn: 36, sowDepthIn: 0.125, provenance: P,
    note: 'The hardiest common rosemary, and still not hardy in a cold zone.' },
  { id: 'sage-common', crop: 'Sage', name: 'Common', family: 'other', lifecycle: 'perennial',
    hardyToF: -20, startIndoorsWeeksBefore: 8, transplantWeeksAfter: 1, daysToMaturity: 90,
    spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.25, provenance: P },
  { id: 'mint-spearmint', crop: 'Mint', name: 'Spearmint', family: 'other', lifecycle: 'perennial',
    hardyToF: -30, directSowWeeksAfter: 0, daysToMaturity: 90,
    spacingIn: 18, rowSpacingIn: 24, sowDepthIn: 0.25, provenance: P,
    note: 'In a pot, or in the whole bed. There is no third option.' },
  { id: 'chives-common', crop: 'Chives', name: 'Common', family: 'allium', lifecycle: 'perennial',
    hardyToF: -35, directSowWeeksAfter: -2, daysToMaturity: 80,
    spacingIn: 8, rowSpacingIn: 12, sowDepthIn: 0.25, provenance: P },
];

/**
 * The key that says two rows are the same plant: crop and cultivar, folded.
 *
 * The same key `PickVarietyScreen` uses to collapse a farm's own duplicates.
 */
export function varietyKey(v: Pick<LibraryVariety, 'crop' | 'name'>): string {
  return `${v.crop.toLowerCase()}|${v.name.toLowerCase()}`;
}

const HAND_TUNED_IDS = new Set(HAND_TUNED.map((v) => v.id));
const HAND_TUNED_KEYS = new Set(HAND_TUNED.map(varietyKey));

/**
 * The whole library: the hand-tuned entries, then everything the crop tables
 * generate that they do not already cover.
 *
 * ## Why one key was not enough
 *
 * This deduplicated on `id` alone, and the note here said the id was *"slugged
 * from crop and name by the same rule on both sides"*. On the generated side it
 * is. On the hand-tuned side it is typed by hand, and 24 of them do not follow
 * the rule — so **fifteen cultivars shipped twice**, under two ids, with
 * agronomy that disagreed:
 *
 * | picker showed | and also |
 * |---|---|
 * | Golden Bantam, 78 days | Golden Bantam, 80 days |
 * | Provider, 3 in apart | Provider, 4 in apart |
 * | Jalapeño, out 3 weeks after | Jalapeño, out 2 weeks after |
 *
 * `library.test.ts` passed throughout, precisely because the ids differed: a
 * uniqueness check over ids cannot see two rows that are the same plant.
 *
 * All fifteen carry the **same crop and the same name** as their twin —
 * `sweet-corn-golden-bantam` and `corn-golden-bantam` are both "Sweet corn" /
 * "Golden Bantam", and only the slug was typed short. So crop and cultivar is
 * the second key, and it is the one the picker already uses to collapse a
 * farm's own duplicates.
 *
 * **It does not replace the id.** Five pairs are the mirror image — one id, two
 * ways of saying the crop — and crop-and-name cannot see those:
 *
 * ```
 * chard-fordhook-giant     "Swiss chard" / "Fordhook Giant"    hand-tuned, 55d
 * chard-fordhook-giant     "Chard" / "Fordhook Giant"                      60d
 * pea-sugar-snap           "Snap pea" / "Sugar Snap"           hand-tuned, 62d
 * pea-sugar-snap           "Pea" / "Sugar Snap"                            70d
 * mustard-southern-giant   "Mustard greens" / "Southern Giant Curled"  hand-tuned
 * mustard-southern-giant   "Mustard" / "Southern Giant"
 * ```
 *
 * So both keys, each covering what the other misses. Between them they also
 * cover the next one: a hand-tuned entry added tomorrow is caught whichever way
 * its slug and its crop word are typed, which no list of the twenty could do.
 *
 * ## The agronomy the survivors do not inherit
 *
 * The hand-tuned entry wins, per the rule at the top of this file — and a few
 * of the dropped rows carried a field their twin lacks: `successionDays` on
 * Purple Top White Globe (14) and on Yellow Crookneck (21), and the note on
 * Provider that it germinates in colder soil than the rest. Losing those is a
 * real cost of the merge; adding them to the surviving entries changes the
 * numbers, which is the farm's call and not this file's.
 */
export const LIBRARY_VARIETIES: readonly LibraryVariety[] = [
  ...HAND_TUNED,
  ...CATALOGUE_VARIETIES.filter(
    (v) => !HAND_TUNED_IDS.has(v.id) && !HAND_TUNED_KEYS.has(varietyKey(v)),
  ),
];
