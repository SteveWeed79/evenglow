import { describe, expect, it } from 'vitest';
import { SPACE, SURFACE, THEMES, type Theme, type ThemeName } from '@homefarm/mobile/theme/tokens';

/**
 * R7, which has had a "Test" column saying *contrast check in CI* since the
 * spec was written and never had one.
 *
 * **The screen is in the sun**, which is why this app holds body text to 7:1
 * rather than to WCAG AA's 4.5:1. That is a deliberate step past the standard
 * and it is the single rule most likely to be lost by accident, because a
 * colour that fails it looks perfectly fine on the machine it was chosen on.
 *
 * ## Tiered, because a flat 7:1 would be a lie
 *
 * Applying one number to every token would fail every accent in the set and
 * force somebody to disable the check, which is worse than not having it.
 * WCAG's own tiers are the right ones and R7 only raises the first:
 *
 * | Tier | Floor | What it is for |
 * |---|---|---|
 * | `ink` | **7:1** | Prose that leads. R7's own number. |
 * | `inkQuiet` | **7:1** | Prose that follows — a subtitle, a hint, a confirmation. |
 * | `muted` | 4.5:1 | Labels, units, dividers, timestamps — never a sentence. |
 * | accents, `lanternInk` | 3:1 | Graphical objects: rules, bars, dots, marks. |
 *
 * **Two tiers share R7's floor, and that is the point.** R7 sets a floor, not
 * a target, and `ink` clears it by 1.8–2.7×. Reading it as "one colour for all
 * prose" is what left the app with a single volume for every sentence it says.
 * `inkQuiet` is quieter *and* still AAA; the rule did not have to move.
 *
 * What this cannot check is *usage* — whether a sentence was set in `muted`,
 * or a heading tinted to match its own rule. Two of those existed when this
 * file was written (`Screen.tsx`'s trouble title and `Tally.tsx`'s failure
 * line, both rowan at 3.1:1 on the lamplight ground) and both are now ink.
 * That half stays a rule in `tokens.ts` rather than a gate.
 */

const GROUNDS = ['ground', 'raised'] as const;

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channel = (offset: number): number => {
    const c = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

export function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

const themes = Object.entries(THEMES) as [ThemeName, Theme][];

/** Every foreground token, against both surfaces it can sit on. */
function pairs(theme: Theme, token: keyof Theme): { on: string; ratio: number }[] {
  return GROUNDS.map((ground) => ({
    on: ground,
    ratio: contrast(theme[token] as string, theme[ground]),
  }));
}

describe('R7 — body text at 7:1, because the screen is in the sun', () => {
  it.each(themes)('%s reads', (_name, theme) => {
    for (const { on, ratio } of pairs(theme, 'ink')) {
      expect(ratio, `ink on ${on}`).toBeGreaterThanOrEqual(7);
    }
  });
});

/**
 * The second sentence tier, and the reason it is checked at 7:1 like the first.
 *
 * `inkQuiet` exists so prose can be quiet without becoming a label. R7 is a
 * floor rather than a target, and `ink` sits at 1.8–2.7× it, so there was
 * always room underneath for a second tier that is still AAA. Nothing here
 * lowers the floor; this asserts the new tier clears the same one.
 *
 * It is also checked from *above*: a quiet tier that drifts up to `ink` is a
 * tier that has stopped doing its job, and nothing else in this file would
 * notice. That is the failure mode this token was added to prevent.
 */
describe('R7 — secondary prose is quieter and still AAA', () => {
  it.each(themes)('%s reads', (_name, theme) => {
    for (const { on, ratio } of pairs(theme, 'inkQuiet')) {
      expect(ratio, `inkQuiet on ${on}`).toBeGreaterThanOrEqual(7);
    }
  });

  /**
   * Ordering, which is the assertion that caught the first attempt.
   *
   * Bright sun raises every tier — its `muted` is 9.70:1 — so a quiet-prose
   * value picked as a flat number landed *below* the label tier and would have
   * set a hint fainter than the word labelling it.
   */
  it.each(themes)('%s keeps ink louder and muted quieter', (_name, theme) => {
    const worst = (t: 'ink' | 'inkQuiet' | 'muted'): number =>
      Math.min(...pairs(theme, t).map((p) => p.ratio));

    expect(worst('ink')).toBeGreaterThan(worst('inkQuiet'));
    expect(worst('inkQuiet')).toBeGreaterThan(worst('muted'));
  });

  /**
   * The step down from `ink` matches the step up from `muted`.
   *
   * This is the derivation itself, asserted rather than described: each value
   * is the geometric mean of its own theme's pair. A fixed separation would be
   * the wrong test — sun's two tiers are only 1.9× apart where daylight's are
   * 2.8×, so the achievable gap differs per theme and a single number would
   * either fail sun or wave daylight through.
   */
  it.each(themes)('%s sits at the perceptual midpoint', (_name, theme) => {
    const worst = (t: 'ink' | 'inkQuiet' | 'muted'): number =>
      Math.min(...pairs(theme, t).map((p) => p.ratio));

    const stepDown = worst('ink') / worst('inkQuiet');
    const stepUp = worst('inkQuiet') / worst('muted');
    expect(stepDown).toBeCloseTo(stepUp, 1);

    // And a backstop: a tier this close to `ink` would be two names for one
    // colour, however evenly it divided the gap.
    expect(stepDown).toBeGreaterThan(1.3);
  });
});

/**
 * A card has an edge of its own.
 *
 * Not a WCAG rule — the 3:1 floor below is for a boundary that carries
 * meaning, and the hairline border is what carries this one. This is the
 * *surface* against the wall behind it, and it went unmeasured because nothing
 * requires it: daylight shipped at 1.09:1, lamplight at 1.13, and **bright sun
 * at 1.018** — white paper on off-white paper, in the theme that exists for
 * reading a screen in a field at noon. Six cards on a hub read as one field,
 * reported off the tablet exactly that way.
 *
 * The floor is picked rather than derived, and the reasoning is worth stating:
 * there is no standard to inherit here, the three themes now sit between 1.18
 * and 1.22, and a number under what shipped is a guard rather than a
 * restatement. What it forbids is the case that was actually wrong — a surface
 * separated from its ground by nothing but a border.
 *
 * Which surface moves is per theme and is not arbitrary. Every ink is measured
 * at its worst against the *lighter* of the two grounds, so on a dark theme
 * the free direction is down (deepen the wall) and on a light one it is up
 * (lift the card). Moving the other one instead spends contrast the quiet
 * tiers do not have — daylight's `muted` clears AA by 0.32.
 */
/**
 * The glow, composited — the case every other test in this file is blind to.
 *
 * ## What went wrong, and why nothing caught it
 *
 * Every check above measures a flat token against a flat surface. The lamp glow
 * is neither: it is a semi-transparent brass gradient painted *over* `raised`,
 * so the colour a label actually sits on is a composite that appears nowhere in
 * the palette. When the glow went from the Tally alone onto every card, a
 * `muted` label at `SPACE.lg` landed on 2.73:1 against its 4.5 floor and `ink`
 * on 7.11 against 7 — and the suite stayed green, because the tokens it was
 * comparing had not moved.
 *
 * The fix was geometry: the light is centred on the top edge and fades to
 * nothing before the content starts. So what has to be asserted is not an
 * opacity but a **clearance** — that at the y where the first line begins,
 * there is no glow left to darken it.
 *
 * ## Why the falloff is modelled rather than rendered
 *
 * `<Surface>` draws an `<Ellipse>` at `cy = 0` with `ry = glowReach`, filled
 * with a two-stop `RadialGradient` — full colour at the centre, transparent at
 * the edge. Alpha down the centreline is therefore linear in `y / glowReach`,
 * which is the one line of arithmetic below. Rendering it would need a browser
 * and would assert the same number.
 */
describe('the lamp glow leaves the text alone', () => {
  /** src-over, the compositing SVG does. */
  function over(fg: string, alpha: number, bg: string): string {
    const ch = (hex: string, i: number): number => parseInt(hex.replace('#', '').slice(i, i + 2), 16);
    const mix = (i: number): string =>
      Math.round(ch(fg, i) * alpha + ch(bg, i) * (1 - alpha))
        .toString(16)
        .padStart(2, '0');
    return `#${mix(0)}${mix(2)}${mix(4)}`;
  }

  /** The token's own alpha, scaled by the gradient's linear falloff at `y`. */
  function glowAt(theme: Theme, y: number, reach: number): number {
    if (theme.glow === null) return 0;
    const peak = Number(/[\d.]+\)$/.exec(theme.glow)?.[0].slice(0, -1) ?? 0);
    return y >= reach ? 0 : peak * (1 - y / reach);
  }

  function glowHex(theme: Theme): string {
    const [r, g, b] = (/rgba\((\d+),\s*(\d+),\s*(\d+)/.exec(theme.glow ?? '') ?? []).slice(1);
    return `#${[r, g, b].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
  }

  /**
   * The two surfaces that light anything, with the y their first line starts
   * at. Both come from the components rather than being restated: a card pads
   * `SPACE.lg`, the Tally `SPACE.xl + SPACE.lg`.
   */
  const lit: [string, number, number][] = [
    ['a card', SPACE.lg, SURFACE.glowReach],
    ['the Tally', SPACE.xl + SPACE.lg, SURFACE.glowReachTally],
  ];

  for (const [theme, name] of [
    [THEMES.lamplight, 'lamplight'],
    [THEMES.daylight, 'daylight'],
    [THEMES.sun, 'sun'],
  ] as [Theme, string][]) {
    for (const [where, contentTop, reach] of lit) {
      it(`holds every floor where ${where}'s text begins, in ${name}`, () => {
        const alpha = glowAt(theme, contentTop, reach);
        const under = alpha === 0 ? theme.raised : over(glowHex(theme), alpha, theme.raised);

        expect(contrast(theme.ink, under), `ink on ${name} ${where}`).toBeGreaterThanOrEqual(7);
        expect(contrast(theme.inkQuiet, under), `inkQuiet on ${name} ${where}`).toBeGreaterThanOrEqual(7);
        expect(contrast(theme.muted, under), `muted on ${name} ${where}`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  /**
   * And the other half of the bargain: the light has to be doing something.
   *
   * A glow dimmed until it were safe would pass everything above and be
   * pointless — the whole reason it is on a card is that lamplight has no
   * luminance headroom left to separate a surface from its wall. So the lit
   * edge is held to a floor of its own, well above the 1.15 a flat card needs.
   */
  it('still separates a lamplit card from its wall at the edge', () => {
    const theme = THEMES.lamplight;
    const peak = glowAt(theme, 0, SURFACE.glowReach);
    const edge = over(glowHex(theme), peak, theme.raised);
    expect(contrast(theme.ground, edge)).toBeGreaterThanOrEqual(2);
  });

  /**
   * **The light themes carry no glow, and that is asserted rather than
   * assumed.** Over a near-white card the wash darkens toward the wall: it took
   * daylight from 1.222 to 1.064 and sun from 1.180 to 1.031, subtracting the
   * separation it was added to make. Anything that reintroduced it here would
   * pass every check above — it damages the card edge, not the text — so this
   * is the only place that would notice.
   */
  it('is a lamplight feature, because on a pale card it subtracts', () => {
    expect(THEMES.daylight.glow).toBeNull();
    expect(THEMES.sun.glow).toBeNull();
    expect(THEMES.lamplight.glow).not.toBeNull();
  });
});

describe('a card can be told from the wall', () => {
  it.each(themes)('%s separates its surfaces', (_name, theme) => {
    expect(contrast(theme.ground, theme.raised)).toBeGreaterThanOrEqual(1.15);
  });
});

describe('labels clear AA, which is what a label needs', () => {
  /**
   * `muted` is deliberately below 7:1 — it is the quiet token and quietness is
   * the job. The floor that matters is AA, because a stat label nobody can
   * read is a stat nobody can read.
   */
  it.each(themes)('%s labels read', (_name, theme) => {
    for (const { on, ratio } of pairs(theme, 'muted')) {
      expect(ratio, `muted on ${on}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('every mark, rule and bar clears the graphical floor', () => {
  /**
   * This is the tier that caught something.
   *
   * `leaf` was `#6b8f52` and measured **2.97:1 on the daylight ground** —
   * under 3:1, which means the healthy dot and the done tick were the two
   * marks in the app that could not be relied on to be seen at all, in the
   * theme most people use. Nothing failed loudly; it just wasn't there.
   */
  it.each(themes)('%s marks are visible', (_name, theme) => {
    for (const token of ['leaf', 'rowan', 'damson', 'lanternInk'] as const) {
      for (const { on, ratio } of pairs(theme, token)) {
        expect(ratio, `${token} on ${on}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  /**
   * `lantern` is exempt from every floor above, and the exemption is deliberate
   * rather than an oversight to be tightened later.
   *
   * It is a **fill**, not an ink — 1.55:1 on the daylight ground. A first
   * draft of this file asserted 3:1 for it, on the reasoning that a button
   * must be distinguishable from its surface, and that assertion was wrong:
   * WCAG 1.4.11 asks for 3:1 on the parts of a control that are *needed to
   * identify it*, and a brass rectangle carrying a label at 8.7:1 is
   * identified by the label. The soft boundary is the burrow (UX-SPEC §2)
   * working as intended, not a defect.
   *
   * What is genuinely required is the assertion below, and it caught the worse
   * of the two failures in this pass.
   *
   * Nine components hardcoded `#241c14` on the brass, which is 8.7:1 on the
   * two ambient themes and **3.9:1 in bright sun** — because sun darkens the
   * fill so the button can be seen against white at all. The theme that exists
   * for reading a screen in a field at noon had the least readable button in
   * the app. `lanternOn` is now the theme's own answer, and every one of those
   * nine reads it.
   */
  it.each(themes)('%s: what sits on the brass can be read', (_name, theme) => {
    expect(contrast(theme.lanternOn, theme.lantern)).toBeGreaterThanOrEqual(4.5);
  });

  /** The other filled control: white on rowan, for anything destructive. */
  it.each(themes)('%s: the danger label can be read on its fill', (_name, theme) => {
    expect(contrast('#ffffff', theme.rowan)).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * A guard on the guard: a token that stopped being a hex would silently pass
 * every assertion above, because `luminance` would parse `NaN` and comparisons
 * against `NaN` fail rather than throw — but a token that is `transparent`
 * would sail through as pure black.
 */
describe('the check itself', () => {
  it.each(themes)('%s: every colour it measures is a literal hex', (_name, theme) => {
    for (const token of ['ground', 'raised', 'ink', 'muted', 'leaf', 'rowan', 'damson',
                         'lantern', 'lanternInk', 'lanternOn'] as const) {
      expect(theme[token], token).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('measures a known pair correctly', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
});
