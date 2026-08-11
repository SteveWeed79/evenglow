import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// Plain .mjs build scripts, like `png.mjs` above them — TS resolves and infers
// these, so the assertions below are checked against the real thing.
import { glyphCoverage, internals } from '../../scripts/lib/glyph.mjs';

/**
 * The letterform behind `pnpm make:icon`.
 *
 * The launcher icon is an S taken out of the app's own display `.ttf` rather
 * than drawn to resemble one, so the outline cannot quietly stop matching the
 * headings. That makes the extraction load-bearing: if it is wrong, the mark on
 * every phone is wrong, and the only place it would ever be noticed is a
 * home screen.
 */

const FONT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../apps/mobile/assets/fonts/Fraunces-Soft30Wonk1-Bold.ttf',
);

describe('a curve flattened from a font', () => {
  /**
   * The bug this file exists for, and it shipped a visibly wrong icon.
   *
   * `curveTo` read the start point from `current` INSIDE its own loop, and
   * `lineTo` advances `current` — so each sub-step evaluated a Bézier from
   * wherever the last one had landed. The result is not that curve; it is a
   * fan of ever-shorter chords, and at 1024px the S came out visibly
   * polygonal.
   *
   * It is asserted on the geometry rather than on the picture because the
   * picture is what nobody checks: a slightly faceted curve looks like a
   * rendering artefact, not like a defect, right up until somebody views it
   * large.
   */
  it('follows the curve rather than chasing its own tail', () => {
    // A single quadratic: on-curve at (0,0), control at (100,100), on at
    // (200,0). The classic arch — its midpoint must sit at (100, 50).
    const contour = [
      { x: 0, y: 0, on: true },
      { x: 100, y: 100, on: false },
      { x: 200, y: 0, on: true },
    ];

    const edges = internals.flatten([contour], 8);
    // Every point the flattening produced, in order.
    const points = [{ x: edges[0]!.x0, y: edges[0]!.y0 }, ...edges.map((e) => ({ x: e.x1, y: e.y1 }))];

    // At t = 0.5 a quadratic sits at (p0 + 2c + p2) / 4 — here (100, 50).
    const middle = points[4]!;
    expect(middle.x).toBeCloseTo(100, 6);
    expect(middle.y).toBeCloseTo(50, 6);

    // And it is symmetric, which the moving-start version never was: its
    // second half collapsed toward the end point.
    const quarter = points[2]!;
    const threeQuarters = points[6]!;
    expect(quarter.y).toBeCloseTo(threeQuarters.y, 6);
  });

  /** A closed contour comes back to where it started. */
  it('closes the contour it opened', () => {
    const square = [
      { x: 0, y: 0, on: true },
      { x: 100, y: 0, on: true },
      { x: 100, y: 100, on: true },
      { x: 0, y: 100, on: true },
    ];

    const edges = internals.flatten([square], 4);
    const last = edges[edges.length - 1]!;
    expect({ x: last.x1, y: last.y1 }).toEqual({ x: edges[0]!.x0, y: edges[0]!.y0 });
  });
});

describe('filling an outline', () => {
  /**
   * Nonzero winding, not even-odd, because that is what TrueType specifies —
   * and the S is the letter that proves it. Get it wrong and the counters fill
   * in, which on this glyph reads as a solid blob rather than a letter.
   */
  it('leaves a counter hollow', () => {
    // A square with a square hole, wound the opposite way — the shape of every
    // O, and of the two bowls of an S.
    const outer = [
      { x: 0, y: 0, on: true },
      { x: 100, y: 0, on: true },
      { x: 100, y: 100, on: true },
      { x: 0, y: 100, on: true },
    ];
    const inner = [
      { x: 30, y: 30, on: true },
      { x: 30, y: 70, on: true },
      { x: 70, y: 70, on: true },
      { x: 70, y: 30, on: true },
    ];

    const coverage = internals.rasterise(internals.flatten([outer, inner], 2), 100, 4);

    expect(coverage[50 * 100 + 10]).toBeCloseTo(1, 1); // in the wall
    expect(coverage[50 * 100 + 50]).toBeCloseTo(0, 1); // in the hole
  });
});

describe('the S the icon is made of', () => {
  it('comes out of the app’s own display face', () => {
    const size = 128;
    const coverage = glyphCoverage({ file: FONT, character: 'S', size, span: 80 });

    expect(coverage).toHaveLength(size * size);
    // Ink, but nowhere near solid: a letter covers a fraction of its tile, and
    // a full canvas would mean the fill leaked.
    const inked = coverage.reduce((sum, a) => sum + a, 0) / coverage.length;
    expect(inked).toBeGreaterThan(0.1);
    expect(inked).toBeLessThan(0.45);
  });

  /**
   * Centred on its own ink rather than on the advance width.
   *
   * Sidebearings exist to space a letter against its neighbours. An icon has
   * no neighbours, so carrying them would show up as a mark sitting slightly
   * left of centre and nothing else — the kind of wrongness that is obvious
   * on a home screen and invisible in a diff.
   */
  it('is centred on the letter, not on its sidebearings', () => {
    const size = 256;
    const coverage = glyphCoverage({ file: FONT, character: 'S', size, span: 160 });

    let minX = size;
    let maxX = -1;
    let minY = size;
    let maxY = -1;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (coverage[y * size + x]! < 0.03) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    /**
     * Within a pixel and a half of dead centre on both axes.
     *
     * Stated as a tolerance rather than with `toBeCloseTo`, because these are
     * pixel INDICES: ink filling a 160-wide span centred on 128 occupies 48
     * through 207, whose midpoint is 127.5 and never 128. A tighter assertion
     * fails on geometry that is exactly right, which is the kind of test that
     * gets loosened until it proves nothing.
     */
    expect(Math.abs((minX + maxX) / 2 - size / 2)).toBeLessThanOrEqual(1.5);
    expect(Math.abs((minY + maxY) / 2 - size / 2)).toBeLessThanOrEqual(1.5);
    // And it fills the span it was asked for, on its widest axis.
    expect(Math.max(maxX - minX, maxY - minY)).toBeCloseTo(160, -1);
  });

  /** A letter the font does not have is a stop, not a blank icon. */
  it('refuses a character it cannot find', () => {
    expect(() => glyphCoverage({ file: FONT, character: '\u{1F411}', size: 64, span: 40 })).toThrow(
      /no glyph/i,
    );
  });
});
