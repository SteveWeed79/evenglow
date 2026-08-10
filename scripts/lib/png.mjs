/**
 * Just enough PNG to answer two questions about a launcher icon: how big is
 * it, and how much of the canvas does its visible content actually span.
 *
 * Hand-rolled rather than a dependency, for the reason CLAUDE.md gives: this
 * reads twenty-four bytes of header and one zlib stream. A PNG decoder would
 * be a build dependency carried forever to check four images.
 *
 * Split out of `check-assets.mjs` so it can be tested — see
 * `tests/unit/png.test.ts`, which synthesises images with every filter type
 * and a known answer. An unfilter written from the spec and never run against
 * real bytes is exactly the code that quietly passes a bad icon.
 */

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Header plus the concatenated image data.
 *
 * Hand-rolled rather than a dependency, for the reason CLAUDE.md gives: this
 * reads twenty-four bytes of header and, for one file, one zlib stream. A PNG
 * decoder would be a build dependency carried forever to check four images.
 */
function readPng(file) {
  const buffer = readFileSync(file);
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) return null;

  const header = {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colourType: buffer[25],
    interlace: buffer[28],
    data: [],
  };

  // Walk the chunks for IDAT. Offset 8 is the first chunk length.
  let at = 8;
  while (at + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') header.data.push(buffer.subarray(at + 8, at + 8 + length));
    if (type === 'IEND') break;
    at += 12 + length; // length + type + data + crc
  }

  return header;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * The alpha channel, unfiltered, or null when the file is a shape this does
 * not decode.
 *
 * **Null is a skip, not a pass.** Interlaced, paletted and 16-bit files are
 * legal PNGs this deliberately does not implement, and an exporter that
 * produces one would otherwise get waved through with a silent yes. It says so
 * instead — the same "stated rather than hidden" line `check:icons` takes about
 * geometry.
 */
function alphaChannel(png) {
  if (png.interlace !== 0 || png.bitDepth !== 8) return null;
  // 6 = RGBA, 4 = grey+alpha. Anything without alpha cannot have a bounding
  // box measured, and a fully opaque foreground fills the canvas by definition.
  const channels = png.colourType === 6 ? 4 : png.colourType === 4 ? 2 : 0;
  if (channels === 0) return null;

  const raw = inflateSync(Buffer.concat(png.data));
  const { width, height } = png;
  const stride = width * channels;

  const out = new Uint8Array(width * height);
  const previous = new Uint8Array(stride);
  const current = new Uint8Array(stride);

  let at = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[at];
    at += 1;
    if (at + stride > raw.length) return null;

    for (let i = 0; i < stride; i += 1) {
      const x = raw[at + i];
      const a = i >= channels ? current[i - channels] : 0;
      const b = previous[i];
      const c = i >= channels ? previous[i - channels] : 0;

      current[i] =
        filter === 0 ? x
        : filter === 1 ? (x + a) & 0xff
        : filter === 2 ? (x + b) & 0xff
        : filter === 3 ? (x + ((a + b) >> 1)) & 0xff
        : filter === 4 ? (x + paeth(a, b, c)) & 0xff
        : x;
    }
    at += stride;

    for (let x = 0; x < width; x += 1) out[y * width + x] = current[x * channels + (channels - 1)];
    previous.set(current);
  }

  return out;
}

/** How much of the canvas the visible content spans, on its widest axis. */
function contentFraction(png) {
  const alpha = alphaChannel(png);
  if (alpha === null) return null;

  const { width, height } = png;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  // 8 rather than 0: a glow's outermost falloff is a handful of alpha values
  // that no eye resolves, and counting it would fail an icon that is fine.
  const VISIBLE = 8;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] < VISIBLE) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return 0;
  return Math.max((maxX - minX + 1) / width, (maxY - minY + 1) / height);
}


export { readPng, alphaChannel, contentFraction };
