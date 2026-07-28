#!/usr/bin/env node
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Generates the plaster grain tile.
 *
 * The web token is an SVG filter blended into the ground:
 *
 *   feTurbulence baseFrequency=.9 numOctaves=2, drawn at opacity .4 and
 *   composited with background-blend-mode: soft-light
 *
 * React Native has no filters, no blend modes and no SVG-as-background, so the
 * handoff correctly lists this as needing a shipped asset. This is that asset,
 * generated rather than hand-drawn so it is reproducible and reviewable: the
 * seed is fixed, so re-running this produces the same bytes and a diff on the
 * PNG means someone changed the recipe.
 *
 * Two octaves, matching the filter: a fine per-pixel layer for tooth and a
 * coarser one for the unevenness real plaster has. The result is a neutral
 * grey tile that carries no colour of its own — it is drawn at low opacity
 * over whatever the ground happens to be, so it works in all three themes.
 *
 * Written as a PNG by hand because it is forty lines of zlib and CRC, and the
 * alternative is a native image dependency in the toolchain for one 4 KB file.
 *
 *   node scripts/make-plaster.mjs
 */

/** Tile size in dp. Small enough that repetition is invisible at this grain. */
const TILE_DP = 64;
const SCALES = [1, 2, 3];

/** Fixed, so the output is reproducible. Changing it changes the texture. */
const SEED = 0x5eed_1a11;

/** xorshift32 — deterministic across platforms, unlike Math.random. */
function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x1_0000_0000;
  };
}

/**
 * A value-noise layer at one cell size, sampled with bilinear interpolation
 * and wrapped so the tile is seamless.
 */
function octave(size, cells, next) {
  const grid = Array.from({ length: cells * cells }, next);
  const at = (cx, cy) => grid[(cy % cells) * cells + (cx % cells)];
  const step = size / cells;

  const out = new Float64Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = x / step;
      const gy = y / step;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      // Smoothstep, so cell boundaries do not show as a grid.
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);

      const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
      const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
      out[y * size + x] = top * (1 - sy) + bottom * sy;
    }
  }
  return out;
}

function tile(size) {
  const next = rng(SEED);
  // Fine tooth, then broader unevenness. numOctaves=2, weighted as the filter
  // weights them: the second octave contributes half.
  const fine = octave(size, size, next);
  const coarse = octave(size, Math.max(2, size >> 3), next);

  const pixels = new Uint8Array(size * size);
  for (let i = 0; i < pixels.length; i++) {
    const v = (fine[i] * 2 + coarse[i]) / 3;
    // Centred on mid-grey with modest contrast: this is drawn at low opacity,
    // so a full-range tile would read as static rather than as tooth.
    pixels[i] = Math.round(128 + (v - 0.5) * 150);
  }
  return pixels;
}

// ── PNG ─────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb8_8320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffff_ffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffff_ffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale — no colour of its own, so it serves all three themes
  // 10..12: compression, filter, interlace, all zero.

  // One filter byte per scanline, filter type 0 (none). Noise does not predict,
  // so a smarter filter would only cost CPU.
  const raw = Buffer.alloc(size * (size + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size + 1)] = 0;
    Buffer.from(pixels.subarray(y * size, (y + 1) * size)).copy(raw, y * (size + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = fileURLToPath(new URL('../apps/mobile/assets/', import.meta.url));
mkdirSync(dir, { recursive: true });

for (const scale of SCALES) {
  const size = TILE_DP * scale;
  const name = scale === 1 ? 'plaster.png' : `plaster@${scale}x.png`;
  const bytes = png(size, tile(size));
  writeFileSync(dir + name, bytes);
  console.log(`${name.padEnd(16)} ${size}×${size}  ${bytes.length} bytes`);
}
