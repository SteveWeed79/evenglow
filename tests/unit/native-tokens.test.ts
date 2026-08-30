import { describe, expect, it } from 'vitest';
import { FONTS, SURFACE, TAP, THEMES, TYPE, type ThemeName } from '@homefarm/mobile/theme/tokens';
import { cardPath } from '@homefarm/mobile/theme/surface';

/**
 * The CSS-parsing checks, ported.
 *
 * `tests/unit/contrast.test.ts` reads `styles.css` and asserts against the
 * tokens the web app actually ships. The moment the tokens became a TypeScript
 * object that check stopped covering the client that matters, and the porting
 * notes are explicit that these must be ported rather than dropped.
 *
 * So this is the same rules against `THEMES` — and against all **three**
 * themes, where the CSS version could only reach two easily: bright sun is an
 * attribute selector on the web and a first-class theme here.
 */

/** WCAG 2.1 relative luminance. Same maths as the CSS version. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = channels as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const NAMES: ThemeName[] = ['daylight', 'lamplight', 'sun'];

describe('R7 — contrast, in every theme', () => {
  describe.each(NAMES)('%s', (name) => {
    const t = THEMES[name];

    it('body text holds 7:1 on the page ground', () => {
      expect(contrast(t.ink, t.ground)).toBeGreaterThanOrEqual(7);
    });

    it('body text holds 7:1 on card surfaces', () => {
      expect(contrast(t.ink, t.raised)).toBeGreaterThanOrEqual(7);
    });

    /** Secondary text is not body text, so it carries the AA floor. */
    it('secondary text clears 4.5:1 on both surfaces', () => {
      expect(contrast(t.muted, t.ground)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.muted, t.raised)).toBeGreaterThanOrEqual(4.5);
    });

    /**
     * The assertion that found a real defect.
     *
     * The current tab was tinted with `lantern`, and brass on the daylight
     * ground measures 1.55:1 — below even the 3:1 floor for a graphical
     * object, let alone text. The handoff had already solved this for bright
     * sun by darkening the token; it had not been caught for daylight.
     *
     * So `lanternInk` is the brass that may carry a mark or a label, and this
     * holds it to the AA floor on both surfaces in every theme.
     */
    it('the readable brass clears 4.5:1 on both surfaces', () => {
      expect(contrast(t.lanternInk, t.ground)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.lanternInk, t.raised)).toBeGreaterThanOrEqual(4.5);
    });

    /** Overdue is the one alarming colour, and it must read as one. */
    it('the alert colour clears 3:1 on both surfaces', () => {
      expect(contrast(t.rowan, t.ground)).toBeGreaterThanOrEqual(3);
      expect(contrast(t.rowan, t.raised)).toBeGreaterThanOrEqual(3);
    });
  });

  it('covers every theme the app can be in', () => {
    expect(Object.keys(THEMES).sort()).toEqual([...NAMES].sort());
  });
});

describe('R4 — coziness never costs a millimetre', () => {
  /**
   * dp, not px. These are already density-independent, so unlike the CSS
   * version there is no conversion to get wrong — but the floors are the same
   * floors, and a tap target is the one rule a redesign is most likely to
   * shave.
   */
  it.each([
    ['min', 56],
    ['primary', 64],
    ['gap', 12],
  ] as const)('TAP.%s is at least %idp', (key, floor) => {
    expect(TAP[key]).toBeGreaterThanOrEqual(floor);
  });

  it('never lets a secondary target fall below the primary one', () => {
    expect(TAP.primary).toBeGreaterThanOrEqual(TAP.min);
  });
});

describe('type', () => {
  /** 17 is the floor. It is read at arm's length, outdoors, through glasses. */
  it('keeps body text at 17 or above', () => {
    expect(TYPE.body).toBeGreaterThanOrEqual(17);
  });

  it('keeps the scale ordered', () => {
    expect(TYPE.hero).toBeGreaterThan(TYPE.title);
    expect(TYPE.title).toBeGreaterThan(TYPE.lede);
    expect(TYPE.lede).toBeGreaterThan(TYPE.body);
    expect(TYPE.body).toBeGreaterThan(TYPE.label);
  });

  /**
   * The tally is a fraction of the shorter viewport edge, not a px value —
   * `clamp()` has no RN form. A number above 1 here would mean someone had
   * pasted a pixel size in, and the count would fill the screen.
   */
  it('sizes the tally as a fraction of the viewport, not in pixels', () => {
    expect(TYPE.tally).toBeGreaterThan(0);
    expect(TYPE.tally).toBeLessThan(1);
  });

  /**
   * Fraunces' SOFT and WONK axes cannot be set in RN, so the display face has
   * to be a static instance cut at those values. A bare family name here would
   * silently render the default cut.
   */
  it('names a static cut of the display face, not a variable family', () => {
    expect(FONTS.display).toMatch(/Soft\d+Wonk\d+/);
  });
});

describe('the card face, drawn', () => {
  /**
   * ## Why this is drawn at all
   *
   * A rounded rectangle is exactly what `borderRadius` expresses, so the SVG
   * that `archPath` needed — two radii per corner, which RN cannot say — has no
   * such excuse now. It stayed for the glow: a radial gradient clipped to the
   * card, which RN has no styled form of, and which spills at the corners if it
   * is a layer over the surface instead of inside it.
   *
   * So these assert the shape a style would have given, from a path.
   */
  it('uses the same radius on every corner', () => {
    const d = cardPath(200, 120, SURFACE.radius);
    const r = SURFACE.radius;
    // Four corner arcs, one radius, no ellipse anywhere.
    expect(d.match(new RegExp(`A${r} ${r} 0 0 1`, 'g'))).toHaveLength(4);
  });

  /**
   * The defect the arch had, asserted from the other side. Its head was `w / 2`
   * across, so it grew with the surface and dissolved into a flat bulge on a
   * wide card — which is why it was removed. A corner must not do that.
   */
  it('keeps the corner the same as the surface gets wider', () => {
    const narrow = cardPath(120, 120, SURFACE.radius);
    const wide = cardPath(400, 120, SURFACE.radius);
    const corner = `A${SURFACE.radius} ${SURFACE.radius}`;
    expect(narrow).toContain(corner);
    expect(wide).toContain(corner);
  });

  /**
   * A chip can be shorter than twice the radius, and a surface is measured at
   * zero on its first layout. Without the clamp the first draws a path folded
   * through itself and the second an arc SVG renders as a blot.
   */
  it('clamps the radius so a short or unmeasured surface cannot invert', () => {
    expect(cardPath(200, 16, SURFACE.radius)).toContain('A8 8');
    const unmeasured = cardPath(0, 0, SURFACE.radius);
    expect(unmeasured).not.toContain('NaN');
    expect(unmeasured).not.toContain('-');
  });

  it('closes the path, so it fills rather than strokes an open curve', () => {
    expect(cardPath(200, 120, SURFACE.radius).trimEnd().endsWith('Z')).toBe(true);
  });
});
