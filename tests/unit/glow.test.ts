import { describe, expect, it } from 'vitest';
// Plain .mjs build scripts, like `glyph.mjs` beside them — TS resolves and
// infers these, so the assertions below are checked against the real thing.
import { blur, halo, over } from '../../scripts/lib/glow.mjs';
import { compose } from '../../scripts/lib/png-write.mjs';

/**
 * The backlight behind the lamplight splash.
 *
 * The mark on the dark ground is lit rather than tinted — a cream S with the
 * lantern burning behind it, which is the app's motif and the one screen a
 * farm sees before anything else has rendered.
 *
 * Both halves of that fail *plausibly*, which is why they are asserted rather
 * than eyeballed. A wrong composite is a faint dark rim that reads as JPEG
 * mush; a wrong lift is a dark band hugging the letter that reads as a
 * deliberate outline. Neither looks like a defect in a thumbnail, and the
 * splash is only ever seen for a moment.
 */

/** Typed arrays index to `number | undefined` under `noUncheckedIndexedAccess`. */
function at(buffer: Uint8Array | Float32Array, index: number): number {
  const value = buffer[index];
  if (value === undefined) throw new Error(`index ${index} is outside the buffer`);
  return value;
}

/** A one-pixel canvas, as `over` wants it: r, g, b, a with a in 0..255. */
function pixel(r: number, g: number, b: number, a: number): Uint8Array {
  return Uint8Array.from([r, g, b, a]);
}

describe('compositing the letter onto its own glow', () => {
  /**
   * The dark fringe, and the arithmetic that avoids it.
   *
   * Both layers here are translucent — the halo fades to nothing and the
   * letter's edge is antialiased — so this is the case that separates a
   * correct source-over from the one everybody writes. Weighting the two
   * colours and stopping there leaves the result premultiplied against a
   * composite alpha it is then stored beside, and the pixel comes out too
   * dark. Dividing by the composite alpha is the whole fix.
   */
  it('divides by the composite alpha rather than leaving it premultiplied', () => {
    // Half-alpha black over half-alpha white.
    const out = over(pixel(255, 255, 255, 128), pixel(0, 0, 0, 128), 1);

    // a = 0.502 + 0.502(1 - 0.502) = 0.752
    expect(at(out, 3)).toBe(192);

    // colour = (0(0.502) + 255(0.502)(0.498)) / 0.752 = 84.8
    //
    // Skipping the divide gives 64 — noticeably darker, and exactly the rim
    // that appears around a pale mark laid on a soft halo.
    expect(at(out, 0)).toBeGreaterThan(80);
    expect(at(out, 0)).toBeLessThan(90);
  });

  it('lets an opaque letter cover the glow completely', () => {
    const out = over(pixel(233, 178, 60, 255), pixel(240, 231, 213, 255), 1);
    expect([at(out, 0), at(out, 1), at(out, 2), at(out, 3)]).toEqual([240, 231, 213, 255]);
  });

  it('leaves the glow alone where the letter is not', () => {
    const out = over(pixel(233, 178, 60, 180), pixel(240, 231, 213, 0), 1);
    expect([at(out, 0), at(out, 1), at(out, 2), at(out, 3)]).toEqual([233, 178, 60, 180]);
  });

  it('writes nothing where neither layer is', () => {
    const out = over(pixel(0, 0, 0, 0), pixel(0, 0, 0, 0), 1);
    expect(at(out, 3)).toBe(0);
  });
});

describe('spreading the coverage into a halo', () => {
  const SIZE = 32;

  /** A filled square in the middle of an otherwise empty canvas. */
  function block(size: number, from: number, to: number): Float32Array {
    const out = new Float32Array(size * size);
    for (let y = from; y < to; y += 1) for (let x = from; x < to; x += 1) out[y * size + x] = 1;
    return out;
  }

  it('carries light outward from the shape', () => {
    const source = block(SIZE, 14, 18);
    const spread = blur(source, SIZE, 3);

    // Just outside the block: dark before, lit after.
    expect(at(source, 16 * SIZE + 20)).toBe(0);
    expect(at(spread, 16 * SIZE + 20)).toBeGreaterThan(0);

    // And it falls off with distance rather than ending somewhere.
    expect(at(spread, 16 * SIZE + 20)).toBeGreaterThan(at(spread, 16 * SIZE + 23));
    expect(at(spread, 16 * SIZE + 23)).toBeGreaterThan(at(spread, 16 * SIZE + 26));
  });

  /**
   * A blur moves light about; it does not add or destroy any. Off-canvas
   * counts as zero, so this holds only while the falloff stays inside the
   * canvas — which is also the condition the real radius is chosen to meet.
   */
  it('conserves what it spreads', () => {
    const source = block(SIZE, 14, 18);
    const spread = blur(source, SIZE, 3);

    const total = (a: Float32Array): number => a.reduce((sum, v) => sum + v, 0);
    expect(total(spread)).toBeCloseTo(total(source), 3);
  });

  it('does not modify the coverage it was handed', () => {
    // The same coverage draws the letter after it draws the letter's glow.
    const source = block(SIZE, 14, 18);
    const before = Float32Array.from(source);
    blur(source, SIZE, 3);
    expect(Array.from(source)).toEqual(Array.from(before));
  });

  /**
   * The regression, and it is not a rounding nicety.
   *
   * Blurring a letterform this wide thins its coverage — the peak inside a
   * stroke lands near half — so the halo has to be lifted or it reads as a
   * smudge instead of as light. Lifting without a ceiling sends alpha past 1,
   * and `Uint8Array` does not saturate on assignment, it wraps: `3.4 * 255`
   * rounds to 867 and stores as 99. The brightest part of the glow would come
   * out darker than the dimmest, as a hard band hugging the letter.
   */
  it('clamps the lift instead of letting alpha wrap to a dark band', () => {
    const source = block(SIZE, 8, 24);
    const lifted = halo(source, SIZE, 3, 3.4);

    for (let i = 0; i < lifted.length; i += 1) expect(at(lifted, i)).toBeLessThanOrEqual(1);

    // Through the encoder, the core is fully opaque brass — not 99.
    const rgba = compose(lifted, SIZE, '#e9b23c', null);
    expect(at(rgba, (16 * SIZE + 16) * 4 + 3)).toBe(255);
  });

  /**
   * The clamp has to stop at the letter, not flatten the halo.
   *
   * Asserted on a shape wide relative to the radius, because that is the real
   * geometry: the S's thick stroke runs to about 120px against a 73px radius,
   * so its core saturates and its skirt does not. A shape narrower than the
   * radius never reaches 1 at all — which is why the small block above is the
   * wrong fixture for this, and the right one for conservation.
   */
  it('still leaves a falloff after lifting', () => {
    const lifted = halo(block(SIZE, 8, 24), SIZE, 3, 3.4);

    // Saturated where the letter would cover it, and on its way down outside.
    // A clamp that flattened everything would pass the test above and render
    // as a slab of brass with a letter sitting on it.
    expect(at(lifted, 16 * SIZE + 16)).toBe(1);
    expect(at(lifted, 16 * SIZE + 27)).toBeGreaterThan(0);
    expect(at(lifted, 16 * SIZE + 27)).toBeLessThan(1);
    expect(at(lifted, 16 * SIZE + 27)).toBeGreaterThan(at(lifted, 16 * SIZE + 30));
  });
});
