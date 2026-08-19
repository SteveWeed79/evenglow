import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
// A plain .mjs build script — TS resolves and infers it, so the helper types
// below are checked against the real thing rather than asserted.
import { contentFraction, readPng } from '../../scripts/lib/png.mjs';

/**
 * The safe-zone measurement behind `pnpm check:assets`.
 *
 * This exists because the alternative is a hand-written PNG unfilter that has
 * never run against real bytes, sitting in a CI gate, silently returning a
 * plausible number. Every filter type is exercised against an image whose
 * answer is known by construction — the same picture encoded five ways must
 * measure the same, and if the Paeth or Average branch is wrong it cannot.
 */

const CRC: number[] = [];
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * An RGBA PNG with one opaque square centred on a transparent canvas, encoded
 * with the given row filter throughout.
 *
 * Filtering is applied here rather than left at zero precisely so the decoder
 * has to undo it. A real exporter picks adaptively and will use all five.
 */
function squarePng(size: number, square: number, filter: 0 | 1 | 2 | 3 | 4): Buffer {
  const channels = 4;
  const stride = size * channels;
  const from = Math.floor((size - square) / 2);
  const to = from + square;

  const rows: Buffer[] = [];
  const previous = new Uint8Array(stride);

  for (let y = 0; y < size; y += 1) {
    const raw = new Uint8Array(stride);
    for (let x = 0; x < size; x += 1) {
      const inside = x >= from && x < to && y >= from && y < to;
      raw[x * 4 + 0] = inside ? 0x24 : 0;
      raw[x * 4 + 1] = inside ? 0x1c : 0;
      raw[x * 4 + 2] = inside ? 0x14 : 0;
      raw[x * 4 + 3] = inside ? 0xff : 0;
    }

    const encoded = new Uint8Array(stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? raw[i - channels]! : 0;
      const b = previous[i]!;
      const c = i >= channels ? previous[i - channels]! : 0;
      const x = raw[i]!;

      encoded[i] =
        filter === 0 ? x
        : filter === 1 ? (x - a) & 0xff
        : filter === 2 ? (x - b) & 0xff
        : filter === 3 ? (x - ((a + b) >> 1)) & 0xff
        : (x - paeth(a, b, c)) & 0xff;
    }

    rows.push(Buffer.concat([Buffer.from([filter]), Buffer.from(encoded)]));
    previous.set(raw);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = mkdtempSync(path.join(tmpdir(), 'homefarm-png-'));

function write(name: string, buffer: Buffer): string {
  const file = path.join(dir, name);
  writeFileSync(file, buffer);
  return file;
}

/**
 * Read, or say which file was not a PNG.
 *
 * A helper rather than `!` on every call: these are fixtures this file wrote a
 * line earlier, so a null here means the *encoder* below is broken, and a
 * non-null assertion would report that as a confusing property access on null
 * several lines from the cause.
 */
interface Png {
  width: number;
  // Read straight out of the header buffer, so `noUncheckedIndexedAccess`
  // rightly says these could be undefined on a truncated file.
  height: number;
  bitDepth: number | undefined;
  colourType: number | undefined;
}

function mustRead(file: string): Png {
  const png = readPng(file);
  if (png === null) throw new Error(`fixture is not a readable PNG: ${file}`);
  return png;
}

describe('reading the header', () => {
  it('reports the dimensions a launcher icon is checked against', () => {
    const png = mustRead(write('size.png', squarePng(64, 32, 0)));
    expect(png.width).toBe(64);
    expect(png.height).toBe(64);
    expect(png.bitDepth).toBe(8);
    expect(png.colourType).toBe(6);
  });

  it('refuses a file that is not a PNG', () => {
    expect(readPng(write('not.png', Buffer.from('this is not a png')))).toBeNull();
  });
});

describe('measuring the safe zone', () => {
  /**
   * The number that matters: an adaptive foreground may span 66/108 — about
   * 61% — before an OEM mask can clip it.
   */
  it.each([0, 1, 2, 3, 4] as const)('is the same through filter %i', (filter) => {
    const png = mustRead(write(`filter-${filter}.png`, squarePng(100, 50, filter)));
    // 50 of 100 by construction, whatever the row filter did on the way in.
    expect(contentFraction(png)).toBeCloseTo(0.5, 5);
  });

  it('passes an icon inside the safe zone and fails one outside it', () => {
    const inside = mustRead(write('inside.png', squarePng(108, 66, 4)));
    const outside = mustRead(write('outside.png', squarePng(108, 96, 4)));

    expect(contentFraction(inside)).toBeCloseTo(66 / 108, 3);
    expect(contentFraction(outside)).toBeGreaterThan(66 / 108);
  });

  it('reads a fully transparent canvas as empty rather than as full', () => {
    // Nothing drawn is a broken export, and it must not read as a pass.
    expect(contentFraction(mustRead(write('empty.png', squarePng(64, 0, 0))))).toBe(0);
  });

  it('skips rather than guesses on a shape it does not decode', () => {
    // Greyscale, no alpha — a real PNG this deliberately does not measure.
    // `null` is the caller's signal to say so out loud instead of passing.
    const grey = mustRead(path.join(process.cwd(), 'apps/mobile/assets/plaster.png'));
    expect(grey.colourType).toBe(0);
    expect(contentFraction(grey)).toBeNull();
  });
});
