import { describe, expect, it } from 'vitest';
import { TALLY, tallySize } from '@homefarm/mobile/theme/tally';
import { TYPE } from '@homefarm/mobile/theme/tokens';

/**
 * How big the numeral is, which was wrong on every device that is not a
 * portrait phone.
 *
 * The rule was `Math.min(width, height) * TYPE.tally` and the reasoning behind
 * it is sound — a fraction of the shorter edge is the same size in the hand
 * whichever way the phone is held. It just stops being the *only* constraint
 * the moment the shorter edge is the height, or the moment the device is a
 * tablet.
 *
 * Pure, and tested in Node, because `Tally.tsx` cannot be: the previous
 * version could only have been caught by turning a handset sideways, and this
 * project's whole roadmap §6 exists because that is a class of bug nobody
 * finds until a farm does.
 */

/** Real devices, because the numbers are the argument. */
const DEVICES = {
  'small phone': { w: 360, h: 640 },
  'iPhone 12': { w: 390, h: 844 },
  'iPhone 14 Pro Max': { w: 430, h: 932 },
  'Pixel 7 landscape': { w: 915, h: 412 },
  'iPad 11"': { w: 834, h: 1194 },
  'iPad landscape': { w: 1194, h: 834 },
} as const;

describe('the size it lands on', () => {
  /**
   * The case the original rule was written for and got right. Nothing here
   * should move it — a regression that made the phone tally smaller would be
   * trading the common case for the rare ones.
   */
  it('leaves a portrait phone where it was', () => {
    const { w, h } = DEVICES['iPhone 12'];
    expect(tallySize(w, h)).toBeCloseTo(Math.min(w, h) * TYPE.tally, 5);
    expect(tallySize(w, h)).toBeGreaterThan(80);
  });

  /**
   * The defect that shipped.
   *
   * On a 430 × 932 phone turned sideways the shorter edge is 430 — the
   * *height* — so the old rule asked for a 94px numeral on a screen 430pt
   * tall. The tally alone ate the fold, and R1 promises a daily log is three
   * taps from a cold launch, which it is not when the commit button is below
   * it.
   */
  it('does not eat the fold when a phone is turned sideways', () => {
    const { w, h } = DEVICES['Pixel 7 landscape'];
    const old = Math.min(w, h) * TYPE.tally;
    const now = tallySize(w, h);

    expect(old).toBeGreaterThan(now);
    // The numeral, its label, four steppers and a commit button share this
    // column. A fifth of it is what leaves room for the rest.
    expect(now).toBeLessThanOrEqual(h * 0.2);
  });

  /**
   * A tablet asked for 183px, which is not "larger" — it is out of scale.
   * Nothing else on the screen grew with the viewport.
   */
  it('stops growing on a tablet', () => {
    for (const name of ['iPad 11"', 'iPad landscape'] as const) {
      const { w, h } = DEVICES[name];
      expect(tallySize(w, h), name).toBeLessThanOrEqual(TALLY.max);
    }

    expect(tallySize(834, 1194)).toBe(TALLY.max);
  });

  it('stays a tally on the smallest screen it runs on', () => {
    const { w, h } = DEVICES['small phone'];
    expect(tallySize(w, h)).toBeGreaterThanOrEqual(TALLY.min);
  });
});

describe('the bounds hold whatever the viewport is', () => {
  /**
   * Swept rather than sampled, because the failure was a device nobody had.
   * Every viewport from a watch to a desktop-class tablet lands inside the
   * band, and none of them takes more than a fifth of the height.
   */
  it('never leaves the band, at any size', () => {
    for (let w = 240; w <= 1400; w += 17) {
      for (let h = 320; h <= 1400; h += 23) {
        const size = tallySize(w, h);
        expect(size).toBeGreaterThanOrEqual(TALLY.min);
        expect(size).toBeLessThanOrEqual(TALLY.max);
      }
    }
  });

  /**
   * The floor is allowed to win, and has to be — on a very short viewport
   * `ofHeight` would otherwise shrink the numeral to nothing, and a tally that
   * is smaller than a heading has stopped being the one bold element the spec
   * says it is (UX-SPEC §2).
   */
  it('lets the floor beat the height term rather than vanishing', () => {
    expect(tallySize(1024, 300)).toBe(TALLY.min);
  });

  /** Rotation must not be a cliff — the same device either way is comparable. */
  it('gives a phone a similar numeral in both orientations', () => {
    const { w, h } = DEVICES['iPhone 14 Pro Max'];
    const portrait = tallySize(w, h);
    const landscape = tallySize(h, w);

    expect(Math.abs(portrait - landscape)).toBeLessThan(TALLY.min * 0.35);
  });
});
