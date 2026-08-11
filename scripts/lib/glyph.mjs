/**
 * One glyph out of a TrueType file, as a filled coverage map.
 *
 * ## Why this exists rather than a dependency
 *
 * The launcher icon is the letter S in the app's own display face. Not a
 * redrawing of it, not something that resembles it — the same outline the
 * headings are set in, so the icon cannot drift away from the app the way a
 * hand-traced logo does the first time the type changes.
 *
 * Getting that from the shipped `.ttf` needs about two hundred lines: the
 * tables that map a character to an outline, and a scanline fill. The
 * alternative is `opentype.js` plus a rasteriser plus a PNG encoder in the
 * toolchain, for one asset generated once and committed. CLAUDE.md asks what a
 * new dependency replaces and why the platform primitive will not do; here the
 * primitive is a file format with a published spec and no runtime cost.
 *
 * ## What it does not do
 *
 * Composite glyphs (accents, anything assembled from parts) are refused with a
 * clear error rather than half-drawn. Latin capitals are simple glyphs, and a
 * silent wrong answer is worse than a stop.
 *
 * Hinting is ignored, which is correct: hints are for pixel grids at text
 * sizes, and this renders one letter at a thousand pixels.
 */

import { readFileSync } from 'node:fs';

/** The table directory: tag → { offset, length }. */
function tables(buf) {
  const count = buf.readUInt16BE(4);
  const found = new Map();

  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 16;
    found.set(buf.toString('ascii', at, at + 4), {
      offset: buf.readUInt32BE(at + 8),
      length: buf.readUInt32BE(at + 12),
    });
  }

  return found;
}

/**
 * Character → glyph index, through a format 4 subtable.
 *
 * Format 4 is the segmented mapping every Latin font ships for the BMP. The
 * others (0, 6, 12) exist and are not needed for a capital S; an unsupported
 * one is an error rather than a guess.
 */
function glyphIndex(buf, cmapOffset, codePoint) {
  const count = buf.readUInt16BE(cmapOffset + 2);

  let subtable = null;
  for (let i = 0; i < count; i += 1) {
    const at = cmapOffset + 4 + i * 8;
    const platform = buf.readUInt16BE(at);
    const encoding = buf.readUInt16BE(at + 2);
    const offset = cmapOffset + buf.readUInt32BE(at + 4);

    // Windows BMP first, then Unicode. Both are format 4 in practice.
    if ((platform === 3 && encoding === 1) || platform === 0) {
      if (buf.readUInt16BE(offset) === 4) {
        subtable = offset;
        if (platform === 3) break;
      }
    }
  }

  if (subtable === null) throw new Error('No format 4 cmap subtable in this font.');

  const segCount = buf.readUInt16BE(subtable + 6) / 2;
  const endCodes = subtable + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;

  for (let seg = 0; seg < segCount; seg += 1) {
    if (buf.readUInt16BE(endCodes + seg * 2) < codePoint) continue;
    const start = buf.readUInt16BE(startCodes + seg * 2);
    if (start > codePoint) return 0;

    const rangeOffset = buf.readUInt16BE(idRangeOffsets + seg * 2);
    if (rangeOffset === 0) {
      return (codePoint + buf.readInt16BE(idDeltas + seg * 2)) & 0xffff;
    }

    // The indirection the spec is famous for: the offset is from its OWN slot.
    const at = idRangeOffsets + seg * 2 + rangeOffset + (codePoint - start) * 2;
    const index = buf.readUInt16BE(at);
    return index === 0 ? 0 : (index + buf.readInt16BE(idDeltas + seg * 2)) & 0xffff;
  }

  return 0;
}

/** The quadratic contours of one glyph, in font units. */
function contoursOf(buf, glyf, loca, longLoca, index) {
  const start = longLoca ? loca + index * 4 : loca + index * 2;
  const from = longLoca ? buf.readUInt32BE(start) : buf.readUInt16BE(start) * 2;
  const to = longLoca ? buf.readUInt32BE(start + 4) : buf.readUInt16BE(start + 2) * 2;

  // Equal offsets mean a glyph with no outline, like a space.
  if (from === to) return [];

  let at = glyf + from;
  const numberOfContours = buf.readInt16BE(at);
  if (numberOfContours < 0) {
    throw new Error('Composite glyph — not supported, and not needed for a capital.');
  }

  at += 10; // past the contour count and the bounding box

  const ends = [];
  for (let i = 0; i < numberOfContours; i += 1) {
    ends.push(buf.readUInt16BE(at));
    at += 2;
  }

  const total = (ends[ends.length - 1] ?? -1) + 1;
  at += 2 + buf.readUInt16BE(at); // skip the hinting programme

  const flags = [];
  while (flags.length < total) {
    const flag = buf[at];
    at += 1;
    flags.push(flag);
    // Bit 3: the next byte says how many more times to repeat this flag.
    if (flag & 0x08) {
      let repeat = buf[at];
      at += 1;
      while (repeat-- > 0) flags.push(flag);
    }
  }

  /** Coordinates are deltas, and how many bytes each takes depends on its flag. */
  const readAxis = (shortBit, sameBit) => {
    const values = [];
    let value = 0;

    for (const flag of flags) {
      if (flag & shortBit) {
        const delta = buf[at];
        at += 1;
        value += flag & sameBit ? delta : -delta;
      } else if (!(flag & sameBit)) {
        value += buf.readInt16BE(at);
        at += 2;
      }
      // else: same as the previous point, so the delta is zero.
      values.push(value);
    }

    return values;
  };

  const xs = readAxis(0x02, 0x10);
  const ys = readAxis(0x04, 0x20);

  const contours = [];
  let first = 0;
  for (const end of ends) {
    const points = [];
    for (let i = first; i <= end; i += 1) {
      points.push({ x: xs[i], y: ys[i], on: (flags[i] & 0x01) === 1 });
    }
    contours.push(points);
    first = end + 1;
  }

  return contours;
}

/**
 * Contours → straight edges, in font units.
 *
 * TrueType curves are quadratic, and two consecutive off-curve points imply an
 * on-curve point exactly between them — the compression trick that makes an
 * outline shorter and a parser longer. Both are handled here so the rasteriser
 * below only ever sees line segments.
 */
function flatten(contours, steps) {
  const edges = [];

  for (const points of contours) {
    if (points.length === 0) continue;

    // Start somewhere on the curve, inventing the midpoint if the contour
    // begins off it — which is legal and does happen.
    let startIndex = points.findIndex((p) => p.on);
    let start;
    if (startIndex === -1) {
      const a = points[0];
      const b = points[points.length - 1];
      start = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      startIndex = 0;
    } else {
      start = points[startIndex];
      startIndex += 1;
    }

    let current = start;
    let control = null;

    const lineTo = (to) => {
      if (current.x !== to.x || current.y !== to.y) {
        edges.push({ x0: current.x, y0: current.y, x1: to.x, y1: to.y });
      }
      current = to;
    };

    const curveTo = (c, to) => {
      // Captured BEFORE the loop, because `lineTo` advances `current` and a
      // Bézier evaluated from a moving start point is not that Bézier. It is a
      // fan of ever-shorter chords, and it renders as a curve with the corners
      // sanded off — visibly polygonal at 1024px, which is how it was caught.
      const from = current;

      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const u = 1 - t;
        lineTo({
          x: u * u * from.x + 2 * u * t * c.x + t * t * to.x,
          y: u * u * from.y + 2 * u * t * c.y + t * t * to.y,
        });
      }
    };

    for (let i = 0; i < points.length; i += 1) {
      const point = points[(startIndex + i) % points.length];

      if (point.on) {
        if (control === null) lineTo(point);
        else {
          const c = control;
          control = null;
          curveTo(c, point);
        }
        continue;
      }

      if (control !== null) {
        // Two off-curve in a row: the implied on-curve point sits between them.
        const c = control;
        curveTo(c, { x: (c.x + point.x) / 2, y: (c.y + point.y) / 2 });
      }
      control = point;
    }

    if (control === null) lineTo(start);
    else curveTo(control, start);
  }

  return edges;
}

/**
 * Edges → an antialiased coverage map, by scanline fill with the nonzero rule.
 *
 * Nonzero rather than even-odd because that is what TrueType specifies: an
 * outer contour runs one way and a counter runs the other, and the bowl of an
 * S has to come out hollow.
 *
 * Vertical antialiasing comes from `samples` scanlines per pixel row;
 * horizontal is exact, because a span's fractional ends are added as fractions
 * rather than rounded. That asymmetry is deliberate — the cost is linear in
 * `samples` and the eye finds vertical stepping on a curve first.
 */
function rasterise(edges, size, samples) {
  const coverage = new Float64Array(size * size);
  const perSample = 1 / samples;

  for (let row = 0; row < size * samples; row += 1) {
    const y = (row + 0.5) / samples;
    const crossings = [];

    for (const edge of edges) {
      const { x0, y0, x1, y1 } = edge;
      if (y0 === y1) continue;
      const low = Math.min(y0, y1);
      const high = Math.max(y0, y1);
      if (y < low || y >= high) continue;

      crossings.push({
        x: x0 + ((y - y0) / (y1 - y0)) * (x1 - x0),
        direction: y1 > y0 ? 1 : -1,
      });
    }

    if (crossings.length === 0) continue;
    crossings.sort((a, b) => a.x - b.x);

    let winding = 0;
    const line = (row / samples) | 0;

    for (let i = 0; i < crossings.length - 1; i += 1) {
      winding += crossings[i].direction;
      if (winding === 0) continue;

      const from = Math.max(0, crossings[i].x);
      const to = Math.min(size, crossings[i + 1].x);
      if (to <= from) continue;

      const firstPixel = Math.floor(from);
      const lastPixel = Math.min(size - 1, Math.ceil(to) - 1);

      for (let x = firstPixel; x <= lastPixel; x += 1) {
        const overlap = Math.min(to, x + 1) - Math.max(from, x);
        if (overlap > 0) coverage[line * size + x] += overlap * perSample;
      }
    }
  }

  for (let i = 0; i < coverage.length; i += 1) {
    if (coverage[i] > 1) coverage[i] = 1;
  }

  return coverage;
}

/**
 * A character from a font file, rendered to fill `span` pixels on its widest
 * axis and centred on a `size` canvas.
 *
 * Centred on the glyph's own ink rather than on its advance width or its
 * em-box: an icon is one letter with nothing beside it, so its sidebearings —
 * which exist to space it against other letters — would show up as an
 * off-centre mark and nothing else.
 */
export function glyphCoverage({ file, character, size, span, samples = 8, steps = 16 }) {
  const buf = readFileSync(file);
  const found = tables(buf);

  const head = found.get('head');
  const maxp = found.get('maxp');
  const loca = found.get('loca');
  const glyf = found.get('glyf');
  const cmap = found.get('cmap');
  if (!head || !maxp || !loca || !glyf || !cmap) {
    throw new Error('Not a TrueType outline font — a required table is missing.');
  }

  const longLoca = buf.readInt16BE(head.offset + 50) === 1;
  const index = glyphIndex(buf, cmap.offset, character.codePointAt(0));
  if (index === 0) throw new Error(`The font has no glyph for ${JSON.stringify(character)}.`);

  const contours = contoursOf(buf, glyf.offset, loca.offset, longLoca, index);
  if (contours.length === 0) throw new Error(`${JSON.stringify(character)} has no outline.`);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const points of contours) {
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }

  const scale = span / Math.max(maxX - minX, maxY - minY);
  const width = (maxX - minX) * scale;
  const height = (maxY - minY) * scale;
  const offsetX = (size - width) / 2;
  const offsetY = (size - height) / 2;

  // Font y runs up the page and a raster's runs down it, so the glyph is
  // flipped here rather than in every consumer.
  const placed = contours.map((points) =>
    points.map((p) => ({
      x: offsetX + (p.x - minX) * scale,
      y: offsetY + (maxY - p.y) * scale,
      on: p.on,
    })),
  );

  return rasterise(flatten(placed, steps), size, samples);
}

export const internals = { tables, glyphIndex, contoursOf, flatten, rasterise };
