import { expand, type Cultivar } from './crops';
import type { LibraryVariety } from './types';

/**
 * The cultivars, as a name and a number.
 *
 * ## Why this is a table and not a list of records
 *
 * Everything else a variety carries — family, when it starts, how far apart it
 * goes, how deep — belongs to the **crop**, and lives in `crops.ts`. Written
 * per cultivar it is the same eight fields repeated forty times for tomatoes
 * alone, which is forty chances to get one of them subtly wrong and no way to
 * fix them all at once. Written here, adding a cultivar is a name and how long
 * it takes.
 *
 * ## Days to maturity is from the right place, per crop
 *
 * A catalogue's "days" counts from transplant for anything started indoors and
 * from sowing for anything direct-sown, and the due engine already anchors the
 * same way — `anchor = transplantedAt ?? sownAt`. So these are catalogue days
 * as printed, and they land correctly because the crop's own timing decides
 * which end they count from.
 *
 * Overwintering crops are the exception worth knowing about: garlic, autumn
 * wheat, biennial bulbs. Their figures are from planting to harvest across the
 * winter, which is why they read as 200-plus rather than 90.
 *
 * ## Nothing here is authoritative
 *
 * Every figure is `commonly-published` — the number a seed catalogue prints,
 * which is a fair season in a fair year and not a promise. A farm's own record
 * of what actually happened beats it from the second season on, and the whole
 * override rule exists so the library can be revised without touching it.
 *
 * ## What is not here
 *
 * Berries, orchard fruit, and mushrooms. Not because they do not belong on a
 * farm, but because a blueberry bush planted once and picked for thirty years
 * files every one of those harvests under the season it went in, and
 * `readNumbers` would then compare 2020 against nothing. That wants a decision
 * about what a `planting` means for a perennial before it wants a list of
 * names.
 */

/**
 * Keyed by crop, exactly as `CROP_DEFAULTS` keys it. A crop with no entry here
 * is still a crop a farm can add its own varieties to — the two tables are
 * independent on purpose.
 */
const CULTIVARS: Readonly<Record<string, readonly Cultivar[]>> = {
  // ── 1. solanaceae ──────────────────────────────────────────────────────────
  Tomato: [
    ['Brandywine', 85],
    ['Cherokee Purple', 80],
    ['German Johnson', 78],
    ['Beefmaster', 80],
    ['Early Girl', 57],
    ['Striped German', 78],
    ['Mortgage Lifter', 85],
    ["Kellogg's Breakfast", 80],
    ['Black Krim', 80],
    ["Aunt Ruby's German Green", 85],
    ['San Marzano', 80, 'Paste. The one most sauce recipes were written around.'],
    ['Roma', 75],
    ['Amish Paste', 85],
    ['Opalka', 85],
    ['Jersey Devil', 80],
    ['Sungold', 57],
    ['Sweet 100', 65],
    ['Black Cherry', 65],
    ['Yellow Pear', 78],
    ["Matt's Wild Cherry", 60, 'Tiny, endless, and it reseeds itself into next year whether asked or not.'],
    ['Juliet', 60],
    ['Chocolate Sprinkles', 65],
  ],
  Pepper: [
    ['California Wonder', 75],
    ['King of the North', 68, 'Bells that actually ripen in a short season.'],
    ['Sweet Banana', 72],
    ['Jimmy Nardello', 80],
    ['Marconi Red', 80],
    ['Carmen', 75],
    ['Orange Horizon', 75],
    ['Chocolate Beauty', 85],
    ['Jalapeño', 70],
    ['Poblano', 75],
    ['Serrano', 75],
    ['Habanero', 100],
    ['Cayenne', 75],
    ["Thai Bird's Eye", 85],
    ['Shishito', 60],
    ['Padrón', 60],
    ['Anaheim', 80],
    ['Tabasco', 90],
    ['Ghost Pepper', 120, 'Needs a long hot season to ripen, and gloves to pick.'],
    ['Carolina Reaper', 130, 'Gloves, and do not touch your face afterwards.'],
    ['Fish Pepper', 80],
    ['Scotch Bonnet', 100],
  ],
  Eggplant: [
    ['Black Beauty', 80],
    ['Ping Tung Long', 65],
    ['Ichiban', 60],
    ['Rosa Bianca', 75],
    ['Little Fingers', 60],
    ['Fairy Tale', 50],
  ],
  Potato: [
    ['Yukon Gold', 90],
    ['Russet Burbank', 110],
    ['Red Norland', 70, 'The early one — new potatoes while everything else is still growing.'],
    ['French Fingerling', 95],
    ['Purple Majesty', 95],
    ['Adirondack Blue', 95],
  ],
  Tomatillo: [
    ['Toma Verde', 70],
    ['Purple Cobán', 85],
  ],
  'Ground cherry': [["Aunt Molly's", 70, 'Ripe when it drops. Picking it off the plant gets you an unripe one.']],
  'Cape gooseberry': [['Common', 90]],

  // ── 2. cucurbits ───────────────────────────────────────────────────────────
  'Summer squash': [
    ['Black Beauty', 50],
    ['Costata Romanesco', 52],
    ['Early Prolific Straightneck', 50],
    ['Yellow Crookneck', 53],
    ["Benning's Green Tint", 52],
    ['Eight Ball', 40],
    ['Cocozelle', 55],
  ],
  'Winter squash': [
    ['Waltham Butternut', 105],
    ['Spaghetti', 90],
    ['Table Queen Acorn', 80],
    ['Delicata', 100],
    ['Blue Hubbard', 110, 'Also the standard trap crop — squash bugs go to it instead of everything else.'],
    ['Red Kuri', 95],
    ['Kabocha', 95],
    ['Marina di Chioggia', 100],
    ["Galeux d'Eysines", 95],
  ],
  Pumpkin: [
    ['Connecticut Field', 110],
    ['Sugar Pie', 100],
    ['Jarrahdale', 100],
    ['Cinderella', 105],
  ],
  Cucumber: [
    ['Marketmore 76', 58],
    ['Lemon', 65],
    ['Boston Pickling', 55],
    ['National Pickling', 52],
    ['Spacemaster', 60],
    ['Armenian', 60],
    ['English Telegraph', 60],
    ['Cucamelon', 70],
    ['Diva', 58, 'Sets fruit without a pollinator, which is what you want under cover.'],
  ],
  Watermelon: [
    ['Sugar Baby', 75],
    ['Crimson Sweet', 85],
    ['Moon and Stars', 95],
    ['Charleston Gray', 87],
  ],
  Cantaloupe: [
    ['Ambrosia', 86],
    ["Hale's Best Jumbo", 85],
    ['Hearts of Gold', 85],
  ],
  Melon: [
    ['Honeydew', 110],
    ['Charentais', 78],
    ['Crane', 85],
    ['Canary', 85],
  ],
  Gourd: [
    ['Luffa', 150, 'Left on the vine until the skin goes papery, then peeled for the sponge.'],
    ['Birdhouse', 125],
    ['Snake', 70],
    ['Apple', 120],
    ['Crown of Thorns', 100],
  ],

  // ── 3. brassicas ───────────────────────────────────────────────────────────
  Cabbage: [
    ['Golden Acre', 65],
    ['Late Flat Dutch', 100],
    ['Red Express', 63],
    ['Savoy Perfection', 90],
  ],
  Kale: [
    ['Lacinato', 60],
    ['Red Russian', 50],
    ['Dwarf Blue Curled Scotch', 55],
    ['Thousandhead', 90, 'Grown for stock rather than the kitchen — it keeps producing leaf all winter.'],
  ],
  Broccoli: [
    ['Calabrese', 65],
    ['Waltham 29', 74],
    ['De Cicco', 50],
    ['Purple Sprouting', 220, 'Sown in summer, cut the following spring. It wants the winter.'],
  ],
  'Broccoli raab': [['Rapini', 45]],
  Cauliflower: [
    ['Snowball Y Improved', 68],
    ['Cheddar', 70],
    ['Purple Sicily', 80],
    ['Romanesco', 75],
  ],
  'Brussels sprouts': [['Long Island Improved', 100, 'Sweeter after a hard frost, so this is an autumn crop or nothing.']],
  'Pak choi': [
    ['Baby', 30],
    ['Standard', 50],
  ],
  'Chinese cabbage': [['Michihili', 75]],
  Tatsoi: [['Common', 45]],
  Mizuna: [
    ['Green', 40],
    ['Red', 40],
  ],
  Komatsuna: [['Common', 35]],
  'Choy sum': [['Common', 45]],
  'Gai lan': [['Common', 60]],
  Collards: [
    ['Georgia Southern', 75],
    ['Vates', 75],
  ],
  Mustard: [
    ['Southern Giant', 45],
    ['Red Giant', 45],
    ['Wasabi', 40],
  ],
  Turnip: [
    ['Purple Top White Globe', 55],
    ['Shogoin', 70],
    ['Hakurei', 38],
    ['Forage', 80, 'Grazed in place. The stock lift them themselves.'],
  ],
  Rutabaga: [['American Purple Top', 90]],

  // ── 4. alliums ─────────────────────────────────────────────────────────────
  // Autumn-planted and lifted the following summer, which is why the days run
  // past two hundred. Hardnecks scape and store shorter; softnecks braid.
  Garlic: [
    ['Music', 240, 'Hardneck, porcelain. Big cloves and reliably hardy.'],
    ['German Extra Hardy', 240],
    ['Chesnok Red', 240],
    ['Spanish Roja', 230],
    ['Inchelium Red', 240, 'Softneck — braids, and keeps longest of these.'],
    ['California Early', 230],
    ['Nootka Rose', 240],
    ['Elephant', 250, 'Not a garlic at all — a leek that makes a bulb.'],
  ],
  Onion: [
    ['Walla Walla', 125, 'Long day. Sweet, and does not store.'],
    ['Yellow Paterson', 110, 'Long day, and the storage one.'],
    ['Red Wing', 110],
    ['Texas Early White', 110, 'Short day — for the southern half of the country.'],
    ['Yellow Granex', 110],
    ['Red Creole', 110],
    ['Stuttgarter', 100, 'Grown from sets rather than seed.'],
  ],
  Scallion: [
    ['Evergreen Hardy White', 60],
    ['Tokyo Long White', 65],
  ],
  Leek: [
    ['Lancelot', 100],
    ['American Flag', 120],
    ['King Richard', 75],
  ],
  Shallot: [
    ['French Red', 100],
    ['Dutch Yellow', 100],
  ],
  Chives: [['Common', 80]],
  'Garlic chives': [['Common', 85]],
  'Walking onion': [['Common', 300, 'Sets bulbils on top, falls over, and plants next year itself.']],
  Ramps: [['Common', 730, 'Years from seed. Most people start from bulbs and still wait.']],

  // ── 5. legumes ─────────────────────────────────────────────────────────────
  'Bush bean': [
    ['Blue Lake 274', 58],
    ['Provider', 50, 'Germinates in colder soil than the rest, so it goes in first.'],
    ['Contender', 50],
    ['Roma II', 59],
    ["Dragon's Tongue", 60],
    ['Cherokee Yellow Wax', 52],
    ['Royal Burgundy', 55],
  ],
  'Pole bean': [
    ['Kentucky Wonder', 65],
    ['Rattlesnake', 65],
    ['Lazy Housewife', 80],
    ['Romano', 60],
  ],
  'Runner bean': [['Scarlet Runner', 70]],
  'Yardlong bean': [['Asparagus Bean', 80]],
  'Dry bean': [
    ["Jacob's Cattle", 90],
    ['Black Turtle', 95],
    ['Pinto', 95],
    ['Dark Red Kidney', 100],
    ['Cannellini', 90],
    ['Great Northern', 90],
    ['Cranberry', 85],
    ['Calypso', 85],
    ['Tepary', 90, 'A desert bean — it wants less water than you think.'],
  ],
  Pea: [
    ['Sugar Snap', 70],
    ['Super Sugar Snap', 65],
    ['Oregon Sugar Pod II', 70],
    ['Mammoth Melting Sugar', 70],
    ['Little Marvel', 63],
    ['Green Arrow', 70],
    ['Wando', 68, 'Takes heat better than the rest, which buys a later sowing.'],
    ['Austrian Winter', 100, 'A cover crop and a forage, not a shelling pea.'],
  ],
  Cowpea: [
    ['Black-Eyed Pea', 70],
    ['Purple Hull', 75],
    ['Pinkeye Purple Hull', 70],
  ],
  'Fava bean': [
    ['Windsor', 85],
    ['Aguadulce', 90],
  ],
  Chickpea: [['Garbanzo', 100]],
  Soybean: [
    ['Midori Giant', 80, 'Edamame — picked green, not dried.'],
    ['Field', 110],
  ],
  Peanut: [
    ['Virginia Jumbo', 120],
    ['Spanish', 110],
    ['Valencia', 100],
  ],
  Lentil: [['Pardina', 100]],
  'Sunn hemp': [['Common', 60, 'A summer cover crop. Cut before it sets seed or it becomes the crop.']],

  // ── 6. roots and umbellifers ───────────────────────────────────────────────
  Carrot: [
    ['Danvers 126', 75],
    ['Nantes Coreless', 68],
    ['Chantenay Red Core', 70, 'Short and blunt — the one for heavy ground.'],
    ['Imperator 58', 75],
    ['Purple Haze', 70],
    ['Cosmic Purple', 70],
    ['Paris Market', 55],
  ],
  Radish: [
    ['Cherry Belle', 22],
    ['French Breakfast', 25],
    ['White Icicle', 30],
    ['Watermelon', 60],
    ['Spanish Black', 55],
    ['Tillage', 50, 'Sown to break a pan and left to rot in place over winter.'],
  ],
  Daikon: [['Japanese', 60]],
  Beet: [
    ['Detroit Dark Red', 60],
    ['Early Wonder', 50],
    ['Chioggia', 55],
    ['Touchstone Gold', 55],
  ],
  Mangel: [['Red Mammoth', 100, 'Stock feed. Enormous, and stores through the winter.']],
  Chard: [
    ['Bright Lights', 55],
    ['Fordhook Giant', 60],
    ['Ruby Red', 55],
  ],
  'Sweet potato': [
    ['Beauregard', 100],
    ['Covington', 110],
    ['Vardaman', 110],
    ['Okinawan Purple', 120],
  ],
  Parsnip: [['Hollow Crown', 120, 'Leave them in the ground through a frost — that is what makes them sweet.']],
  Celeriac: [['Common', 100]],
  Salsify: [['Mammoth Sandwich Island', 120]],
  Scorzonera: [['Common', 120]],
  Skirret: [['Common', 150]],
  Sunchoke: [['Common', 130, 'Whatever you leave in the ground is next year’s planting, whether you meant it or not.']],
  Horseradish: [['Common', 150]],
  Jicama: [['Common', 150, 'The root only. The vine and pods are poisonous.']],

  // ── 7. leafy greens ────────────────────────────────────────────────────────
  Lettuce: [
    ['Buttercrunch', 55],
    ['Parris Island Cos', 68],
    ['Black Seeded Simpson', 45],
    ['Red Sails', 45],
    ['Salanova', 55],
    ['Little Gem', 50],
    ['Great Lakes', 80],
    ['Deer Tongue', 55],
    ['Oakleaf', 50],
  ],
  Spinach: [
    ['Bloomsdale Long Standing', 45],
    ['Space', 40],
    ['Tyee', 40],
  ],
  'New Zealand spinach': [['Common', 60, 'Not a spinach. It carries on through the heat, which is the point.']],
  'Malabar spinach': [['Common', 70]],
  Celery: [
    ['Tall Utah', 100],
    ['Chinese Cutting', 80],
  ],
  Radicchio: [['Rosso di Treviso', 80]],
  Endive: [
    ['Broadleaf Batavian', 85],
    ['Frisée', 90],
    ['Witloof', 110, 'Lifted, cut back and forced in the dark for the chicon.'],
  ],
  Arugula: [
    ['Wild', 50],
    ['Astro', 38],
  ],
  Watercress: [['Common', 55]],
  'Land cress': [['Common', 50]],
  Purslane: [['Golden', 50]],
  Sorrel: [
    ['French Broadleaf', 60],
    ['Red Veined', 50],
  ],
  Claytonia: [['Common', 40]],
  Mache: [['Common', 60]],
  Dandelion: [['Catalogna', 60]],
  Orach: [['Common', 40]],

  // ── 8. herbs ───────────────────────────────────────────────────────────────
  Basil: [
    ['Genovese', 68],
    ['Thai Sweet', 65],
    ['Lemon', 60],
    ['Purple', 70],
  ],
  Parsley: [
    ['Italian Flat Leaf', 75],
    ['Triple Curled', 75],
  ],
  Cilantro: [['Santo', 50, 'Bolts in heat. Sowing it again every fortnight is the only answer.']],
  Dill: [
    ['Bouquet', 55],
    ['Mammoth', 65],
  ],
  Marjoram: [['Sweet', 60]],
  Oregano: [['Greek', 90]],
  Thyme: [
    ['English', 90],
    ['Lemon', 90],
  ],
  Rosemary: [
    ['Arp', 180],
    ['Tuscan Blue', 180],
  ],
  Sage: [['Broadleaf', 90]],
  Savory: [['Summer', 60]],
  'Winter savory': [['Common', 90]],
  Tarragon: [['French', 90, 'From a division, never from seed — seed-grown tarragon is the Russian one and tastes of nothing.']],
  Chervil: [['Common', 60]],
  Mint: [
    ['Spearmint', 90],
    ['Peppermint', 90],
    ['Chocolate', 90],
    ['Apple', 90],
  ],
  Lemongrass: [['Common', 100]],
  'Bay laurel': [['Common', 730]],
  Lavender: [
    ['Munstead', 100],
    ['Hidcote', 100],
  ],
  Echinacea: [['Purple Coneflower', 120]],
  Chamomile: [['German', 60]],
  'Roman chamomile': [['Common', 90]],
  Calendula: [['Common', 60]],
  'Lemon balm': [['Common', 70]],
  "St John's wort": [['Common', 90]],
  Valerian: [['Common', 120]],
  Tulsi: [['Common', 75]],
  Plantain: [['Broadleaf', 70]],
  Yarrow: [['Common', 120]],
  Comfrey: [['Bocking 14', 90, 'Sterile, so it stays where it is put. Cut it three times a season for mulch.']],
  Arnica: [['Common', 120]],
  Marshmallow: [['Common', 120]],
  Feverfew: [['Common', 90]],
  Borage: [['Common', 55]],
  Catnip: [['Common', 75]],
  'Anise hyssop': [['Common', 90]],
  Spilanthes: [['Common', 70]],
  'Milk thistle': [['Common', 120]],
  Ashwagandha: [['Common', 180]],
  Elecampane: [['Common', 730, 'The root, in its second autumn.']],
  Skullcap: [['Common', 90]],
  Motherwort: [['Common', 120]],
  Astragalus: [['Common', 730]],
  Ginseng: [['American', 1825, 'Five years to a root worth digging, and shade the whole time.']],

  // ── 9. cut flowers ─────────────────────────────────────────────────────────
  Zinnia: [
    ["Benary's Giant", 75],
    ['Oklahoma', 70],
  ],
  Sunflower: [
    ['Sunrich', 60, 'Pollenless, so it does not shed over the table.'],
    ['Black Oil', 90, 'The birdseed and pressing one.'],
    ['Mammoth Russian', 110],
    ['ProCut Orange', 55],
  ],
  Cosmos: [
    ['Sensation', 75],
    ['Double Click', 80],
  ],
  Cornflower: [['Common', 65]],
  'Sweet pea': [['Common', 85]],
  Celosia: [
    ['Cockscomb', 90],
    ['Plume', 90],
  ],
  Gomphrena: [['Common', 85]],
  Strawflower: [['Common', 85]],
  Statice: [['Common', 110]],
  Nigella: [['Common', 75]],
  Poppy: [
    ['Breadseed', 90],
    ["Lauren's Grape", 90],
  ],
  'California poppy': [['Common', 60]],
  Snapdragon: [
    ['Rocket', 110],
    ['Liberty', 100],
  ],
  Amaranth: [
    ['Opopeo', 90],
    ['Hopi Red Dye', 95],
    ['Golden Giant', 100, 'Grown for the grain rather than the colour.'],
  ],
  Larkspur: [['Common', 100]],
  Dahlia: [
    ['Cafe au Lait', 100],
    ['Dinnerplate', 100],
  ],
  Peony: [
    ['Sarah Bernhardt', 730],
    ['Festiva Maxima', 730],
  ],
  Dianthus: [['Sweet William', 120]],
  Rudbeckia: [['Common', 120]],
  Liatris: [['Common', 90]],
  Milkweed: [
    ['Common', 120],
    ['Swamp', 120],
    ['Butterfly Weed', 120],
  ],
  Tulip: [
    ['Darwin Hybrid', 200],
    ['Parrot', 200],
  ],
  Daffodil: [['Common', 200]],
  Gladiolus: [['Common', 80]],
  'Ornamental allium': [['Giganteum', 240]],
  Ranunculus: [['Tecolote', 90]],
  Anemone: [['Mona Lisa', 90]],

  // ── 12. grains, staples and cover crops ────────────────────────────────────
  'Sweet corn': [
    ['Golden Bantam', 80],
    ['Silver Queen', 92],
    ['Incredible', 85],
  ],
  'Dent corn': [
    ['Hickory King', 110, 'The hominy and grits one — the hull slips in lye.'],
    ["Reid's Yellow Dent", 110],
  ],
  'Flour corn': [['Bloody Butcher', 110]],
  'Flint corn': [['Glass Gem', 110]],
  Popcorn: [['Robust', 100]],
  Wheat: [
    ['Hard Red Winter', 240],
    ['Hard Red Spring', 110],
    ['Soft Red Winter', 240, 'Low protein — pastry flour, not bread.'],
  ],
  Einkorn: [['Common', 240]],
  Emmer: [['Farro', 240]],
  Spelt: [['Common', 240]],
  Barley: [['Hulless', 90, 'Threshes clean, so it can be eaten or malted without hulling gear.']],
  Oats: [['Feed', 100]],
  Rye: [['Winter', 240]],
  Triticale: [['Common', 240]],
  Sorghum: [
    ['Grain', 110],
    ['Sweet', 115, 'Pressed for syrup rather than threshed for grain.'],
  ],
  Buckwheat: [
    ['Japanese', 75],
    ['Silverhull', 80],
  ],
  Quinoa: [['White', 100]],
  Millet: [
    ['Proso', 70],
    ['Pearl', 85],
  ],
  Teff: [['Common', 105]],
  'Wild rice': [['Common', 110]],
  Sesame: [['Common', 100]],
  Hemp: [['Industrial', 110]],
  Flax: [['Linseed', 100]],
  Vetch: [['Hairy', 200, 'Sown in autumn, turned in the spring. It fixes more nitrogen than anything else here.']],
  Clover: [
    ['Crimson', 180],
    ['White Dutch', 200, 'A living mulch — it stays put and gets walked on.'],
    ['Red', 200],
  ],
};

/**
 * Every cultivar in the tables above, as the shape the library ships.
 *
 * `expand` throws on a crop with no defaults, which is the point: a typo in a
 * key here fails the build rather than shipping a variety with no family and no
 * timing at all.
 */
export const CATALOGUE_VARIETIES: readonly LibraryVariety[] = Object.entries(
  CULTIVARS,
).flatMap(([crop, cultivars]) => expand(crop, cultivars));
