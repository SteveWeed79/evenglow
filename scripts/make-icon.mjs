#!/usr/bin/env node
/**
 * Generates the launcher icon and the splash mark.
 *
 *   node scripts/make-icon.mjs
 *
 * ## The mark is a letter, and it is the app's own letter
 *
 * An S in Fraunces Soft — the face every heading in the app is set in, taken
 * from the same `.ttf` the handset loads. Not traced, not approximated: the
 * outline is read out of the font at build time, so the icon cannot quietly
 * stop matching the app the way a hand-drawn logo does the first time somebody
 * changes the type.
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
import { glyphCoverage } from './lib/glyph.mjs';
import { compose, encodePng } from './lib/png-write.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MOBILE = path.join(ROOT, 'apps/mobile');
const FONT = path.join(MOBILE, 'assets/fonts/Fraunces-Soft30Wonk1-Bold.ttf');

/** Expo requires exactly this for every app icon. */
const SIZE = 1024;

/**
 * How much of the canvas the letter spans, per use.
 *
 * `FULL` is a square icon that nothing will mask, so it takes the ordinary
 * margin a letterform wants around it — an S filling its tile edge to edge
 * reads as cramped rather than confident.
 *
 * `FOREGROUND` is the masked one, and 56% sits under the 61.1% (66/108) that
 * `check:assets` allows, with room for the antialiased edge. Going right up to
 * the limit would pass the check and still put the letter's shoulder on the
 * curve of a squircle mask.
 */
const FULL_SPAN = Math.round(SIZE * 0.62);
const FOREGROUND_SPAN = Math.round(SIZE * 0.56);

/** From `apps/mobile/src/theme/tokens.ts`. Changing them there changes them here. */
const DAYLIGHT_GROUND = '#ede6d2';
const DAYLIGHT_INK = '#241c14';
const LAMPLIGHT_GROUND = '#201913';
const LANTERN = '#e9b23c';

const assets = [
  {
    // iOS and the generic slot: the app's ordinary daylight face.
    file: 'assets/icon/steading.png',
    span: FULL_SPAN,
    ink: DAYLIGHT_INK,
    ground: DAYLIGHT_GROUND,
  },
  {
    // Android adaptive. Transparent, because `backgroundColor` in app.json is
    // what sits behind it and the mask cuts them together.
    file: 'assets/icon/steading-foreground.png',
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
    file: 'assets/icon/steading-monochrome.png',
    span: FOREGROUND_SPAN,
    ink: '#ffffff',
    ground: null,
  },
  {
    // The splash marks. Drawn at 1024 and shown at `imageWidth`, so the same
    // file serves every density without a set of @2x variants.
    file: 'assets/splash/steading-daylight.png',
    span: FULL_SPAN,
    ink: DAYLIGHT_INK,
    ground: null,
  },
  {
    file: 'assets/splash/steading-lamplight.png',
    span: FULL_SPAN,
    ink: LANTERN,
    ground: null,
  },
];

for (const asset of assets) {
  const coverage = glyphCoverage({
    file: FONT,
    character: 'S',
    size: SIZE,
    span: asset.span,
  });

  const file = path.join(MOBILE, asset.file);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, encodePng(SIZE, SIZE, compose(coverage, SIZE, asset.ink, asset.ground)));
  console.log(`wrote ${asset.file}`);
}

console.log(`\nGrounds: daylight ${DAYLIGHT_GROUND}, lamplight ${LAMPLIGHT_GROUND}.`);
console.log('Run `pnpm check:assets` to hold them to the safe zone.');
