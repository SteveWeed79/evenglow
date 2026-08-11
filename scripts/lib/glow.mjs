/**
 * The backlight behind the lamplight mark: a blur, and a correct source-over.
 *
 * Split out of `make-icon.mjs` for the same reason `png-write.mjs` was split
 * out of `make-plaster.mjs` — the script that uses it should read as a list of
 * assets, not as a rasteriser. Both functions here are also the kind that fail
 * *plausibly*: a wrong blur is a slightly odd halo and a wrong composite is a
 * faint dark fringe, and neither looks like a bug until somebody views the
 * splash at full size on a dark handset. They are tested rather than eyeballed.
 */

/**
 * Separable box blur, three passes.
 *
 * Three boxes approximate a Gaussian closely enough that no eye separates
 * them, and a box blur slides its window — one add and one subtract per pixel
 * — so cost does not grow with the radius. A true Gaussian at r=73 on a 1024
 * square is millions of multiplies; this is instant.
 *
 * Off-canvas counts as zero, which is what a glow wants: it fades towards the
 * edge rather than smearing the last row outwards.
 *
 * @param source Float-ish coverage, 0..1, length `size * size`.
 * @returns a new Float32Array; `source` is not modified.
 */
export function blur(source, size, radius, passes = 3) {
  let current = Float32Array.from(source);
  let next = new Float32Array(size * size);
  const window = radius * 2 + 1;

  for (let pass = 0; pass < passes; pass += 1) {
    for (const horizontal of [true, false]) {
      for (let a = 0; a < size; a += 1) {
        const at = (b) => (horizontal ? a * size + b : b * size + a);

        // Prime the window at b = 0, then slide it: add one, drop one.
        let sum = 0;
        for (let b = 0; b <= radius && b < size; b += 1) sum += current[at(b)];

        for (let b = 0; b < size; b += 1) {
          next[at(b)] = sum / window;
          const leaving = b - radius;
          const entering = b + radius + 1;
          if (leaving >= 0) sum -= current[at(leaving)];
          if (entering < size) sum += current[at(entering)];
        }
      }
      [current, next] = [next, current];
    }
  }

  return current;
}

/**
 * Source-over on straight (non-premultiplied) alpha.
 *
 * Written out in full rather than as a lerp between colours, because both
 * layers here are translucent — the halo fades to nothing and the letter's
 * edge is antialiased. Blending straight-alpha pixels without dividing the
 * composite alpha back out is what puts the dark fringe around badly
 * composited artwork, and it would show worst exactly where this has to be
 * clean: a pale letter against its own glow.
 *
 * @returns a new Uint8Array; neither input is modified.
 */
export function over(base, top, size) {
  const out = new Uint8Array(size * size * 4);

  for (let i = 0; i < size * size; i += 1) {
    const at = i * 4;
    const sa = top[at + 3] / 255;
    const da = base[at + 3] / 255;
    const a = sa + da * (1 - sa);

    out[at + 3] = Math.round(a * 255);
    if (a === 0) continue;

    for (let c = 0; c < 3; c += 1) {
      out[at + c] = Math.round((top[at + c] * sa + base[at + c] * da * (1 - sa)) / a);
    }
  }

  return out;
}

/**
 * Coverage → the halo's own alpha: spread wide, lifted, and **clamped**.
 *
 * The clamp is not defensive tidiness. Blurring a letterform this far thins
 * its coverage — the peak inside a stroke lands near 0.5 — so the lift is what
 * makes the halo read as light rather than as a smudge, and a lift without a
 * ceiling sends alpha past 1. Writing that into a `Uint8Array` does not
 * saturate, it *wraps*: `Math.round(3.4 * 255)` stores as 43, and the brightest
 * part of the glow comes out as a dark band hugging the letter.
 */
export function halo(coverage, size, radius, strength) {
  const spread = blur(coverage, size, radius);
  for (let i = 0; i < spread.length; i += 1) spread[i] = Math.min(1, spread[i] * strength);
  return spread;
}
