#!/usr/bin/env node
/**
 * Generates the launcher icon and the splash mark.
 *
 *   node scripts/make-icon.mjs
 *
 * ## The mark is a letter, and it is the app's own letter
 *
 * `PRODUCT_NAME`'s first character in Fraunces Soft — the face every heading in
 * the app is set in, taken from the same `.ttf` the handset loads. Not traced,
 * not approximated: the outline is read out of the font at build time, so the
 * icon cannot quietly stop matching the app the way a hand-drawn logo does the
 * first time somebody changes the type.
 *
 * It is read from the brand rather than written down because it already drifted
 * once. The mark was a hardcoded `S`, for Steading, and it stayed an S through
 * the rename — a launcher icon for a product with no S in its name, which no
 * check could catch because nothing here knew what the letter was for.
 *
 * A high-contrast serif at 48dp is a real risk — hairlines are the first thing
 * to disappear — and it survives because the letter is drawn LARGE within its
 * canvas and in one flat colour. What kills a serif at that size is detail
 * competing with detail, not the thin strokes themselves.
 *
 * ## Two grounds, because the app has two
 *
 * Plaster with ink for daylight, loam with brass for lamplight — `tokens.ts`'s
 * own `ground`, `ink` and `lantern`, not colours picked to look like them.
 *
 * The lamplight splash goes one step further and is *backlit*: the letter in
 * the theme's `ink`, with the lantern burning behind it. That is the app's
 * whole motif — a lit sign on a dark building, which is what the name says
 * outright — and lamplight already carries the haze as a token,
 * `glow: rgba(233,178,60,0.30)`, used behind the lit lamp and under the
 * tally's brass. The splash is the first place a farm sees it.
 *
 * Flat brass on loam was the alternative and it is the weaker one: brass on
 * loam is a *coloured* letter, and every other dark surface in the app is lit
 * rather than tinted. It also puts the mark's own colour on the one screen
 * that has no interface to place it against.
 *
 * ## The safe zone is the whole reason this is arithmetic
 *
 * Android masks an adaptive icon to a shape the OEM chooses, and only the
 * centred 66/108 circle is guaranteed to survive. `check:assets` measures that
 * from the alpha channel, so `FOREGROUND_SPAN` below is not a guess that looks
 * about right — it is the number that check enforces, and the two are meant to
 * be read together.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_NAME } from '../packages/contracts/src/product.ts';
import { glyphCoverage } from './lib/glyph.mjs';
import { halo, over } from './lib/glow.mjs';
import { compose, encodePng } from './lib/png-write.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MOBILE = path.join(ROOT, 'apps/mobile');
const FONT = path.join(MOBILE, 'assets/fonts/Fraunces-Opsz30Soft100Wonk1-Bold.ttf');

/** Expo requires exactly this for every app icon. */
const SIZE = 1024;

/**
 * How much of the canvas the letter spans, per use.
 *
 * `FULL` is a square icon that nothing will mask, so it takes the ordinary
 * margin a letterform wants around it — a letter filling its tile edge to edge
 * reads as cramped rather than confident.
 *
 * `FOREGROUND` is the masked one, and 56% sits under the 61.1% (66/108) that
 * `check:assets` allows, with room for the antialiased edge. Going right up to
 * the limit would pass the check and still put the letter's shoulder on the
 * curve of a squircle mask.
 */
/**
 * The letter, and it is derived rather than chosen.
 *
 * `product.ts` is the one place the brand is written, so the icon follows a
 * rename instead of surviving one.
 */
const MARK = PRODUCT_NAME[0];

const FULL_SPAN = Math.round(SIZE * 0.62);
const FOREGROUND_SPAN = Math.round(SIZE * 0.56);

/** From `apps/mobile/src/theme/tokens.ts`. Changing them there changes them here. */
const DAYLIGHT_GROUND = '#ede6d2';
const DAYLIGHT_INK = '#241c14';
const LAMPLIGHT_GROUND = '#201913';
const LAMPLIGHT_INK = '#f0e7d5';
const LANTERN = '#e9b23c';

/**
 * The backlight, in the two numbers that decide whether it reads as light.
 *
 * `RADIUS` is wide on purpose. A tight bloom hugs the outline and reads as a
 * stroke somebody added to the letter — a sticker. A broad one has no edge to
 * find, so the eye takes it for a source behind the mark, which is the thing
 * being drawn. A fourteenth of the canvas puts the falloff well outside the
 * letter without reaching the edges of a 1024 square.
 *
 * `STRENGTH` then lifts it, because blurring a shape this far spreads its
 * coverage thin — the peak inside the stroke lands near 0.5 and a halo at half
 * alpha is a smudge. Multiplying and clamping saturates the core, which is
 * exactly where the opaque letter covers it, and leaves the falloff intact.
 */
const GLOW_RADIUS = Math.round(SIZE / 14);
const GLOW_STRENGTH = 2.4;

/** The lantern behind the mark: the glyph's own coverage, spread and lifted. */
function backlight(coverage, size) {
  return compose(halo(coverage, size, GLOW_RADIUS, GLOW_STRENGTH), size, LANTERN, null);
}

const assets = [
  {
    // iOS and the generic slot: the app's ordinary daylight face.
    file: 'assets/icon/homefarm.png',
    span: FULL_SPAN,
    ink: DAYLIGHT_INK,
    ground: DAYLIGHT_GROUND,
  },
  {
    // Android adaptive. Transparent, because `backgroundColor` in app.json is
    // what sits behind it and the mask cuts them together.
    file: 'assets/icon/homefarm-foreground.png',
    span: FOREGROUND_SPAN,
    ink: LANTERN,
    ground: null,
  },
  {
    /**
     * The themed layer, and it is alpha that matters rather than colour.
     *
     * Android 16 recolours this against the wallpaper, using only the shape.
     * White is the convention; anything else is discarded, so a coloured
     * monochrome layer is a mark somebody spent time on that no phone renders.
     */
    file: 'assets/icon/homefarm-monochrome.png',
    span: FOREGROUND_SPAN,
    ink: '#ffffff',
    ground: null,
  },
  {
    // The splash marks. Drawn at 1024 and shown at `imageWidth`, so the same
    // file serves every density without a set of @2x variants.
    file: 'assets/splash/homefarm-daylight.png',
    span: FULL_SPAN,
    ink: DAYLIGHT_INK,
    ground: null,
  },
  {
    // The lit one. Ink rather than brass for the letter — the brass is the
    // light *behind* it, and a brass letter on a brass haze has nothing to
    // separate the two.
    file: 'assets/splash/homefarm-lamplight.png',
    span: FULL_SPAN,
    ink: LAMPLIGHT_INK,
    ground: null,
    glow: true,
  },
];

for (const asset of assets) {
  const coverage = glyphCoverage({
    file: FONT,
    character: MARK,
    size: SIZE,
    span: asset.span,
  });

  const mark = compose(coverage, SIZE, asset.ink, asset.ground);
  const pixels = asset.glow === true ? over(backlight(coverage, SIZE), mark, SIZE) : mark;

  const file = path.join(MOBILE, asset.file);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, encodePng(SIZE, SIZE, pixels));
  console.log(`wrote ${asset.file}${asset.glow === true ? ' (backlit)' : ''}`);
}

console.log(`\nMark: ${MARK}, for ${PRODUCT_NAME}.`);
console.log(`Grounds: daylight ${DAYLIGHT_GROUND}, lamplight ${LAMPLIGHT_GROUND}.`);
console.log('Run `pnpm check:assets` to hold them to the safe zone.');
