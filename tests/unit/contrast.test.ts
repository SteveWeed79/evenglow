import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * R7 — body text holds 7:1 in every theme, because the screen is in the sun.
 *
 * Parses globals.css rather than re-declaring the values, so the assertion
 * guards the tokens the app actually ships.
 */

const CSS = readFileSync(
  fileURLToPath(new URL('../../src/app/globals.css', import.meta.url)),
  'utf8',
);

function blockAfter(marker: string): string {
  const start = CSS.indexOf(marker);
  if (start === -1) throw new Error(`No CSS block found for "${marker}"`);
  const open = CSS.indexOf('{', start);
  const end = CSS.indexOf('}', open);
  return CSS.slice(open, end);
}

function token(block: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block);
  if (!match?.[1]) throw new Error(`Token --${name} not found or not a hex colour`);
  return match[1];
}

/** WCAG 2.1 relative luminance. */
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

const THEMES = [
  { name: 'daylight', block: blockAfter(':root {') },
  { name: 'lamplight', block: blockAfter('@media (prefers-color-scheme: dark)') },
  { name: 'lamplight (explicit toggle)', block: blockAfter(":root[data-theme='lamplight']") },
  { name: 'daylight (explicit toggle)', block: blockAfter(":root[data-theme='daylight']") },
  { name: 'bright sun', block: blockAfter("[data-contrast='sun']") },
];

describe('contrast', () => {
  describe.each(THEMES)('$name', ({ block }) => {
    const ink = token(block, 'ink');
    const ground = token(block, 'ground');
    const raised = token(block, 'raised');
    const muted = token(block, 'muted');

    it('body text holds 7:1 on the page ground', () => {
      expect(contrast(ink, ground)).toBeGreaterThanOrEqual(7);
    });

    it('body text holds 7:1 on card surfaces', () => {
      expect(contrast(ink, raised)).toBeGreaterThanOrEqual(7);
    });

    // Secondary text is not body text, so it carries the AA floor rather
    // than the 7:1 target.
    it('secondary text clears 4.5:1 on both surfaces', () => {
      expect(contrast(muted, ground)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(muted, raised)).toBeGreaterThanOrEqual(4.5);
    });
  });
});

describe('touch targets', () => {
  const root = blockAfter(':root {');

  it.each([
    ['tap-min', 56],
    ['tap-primary', 64],
    ['tap-gap', 12],
  ])('--%s is at least %ipx', (name, floor) => {
    const match = new RegExp(`--${name}:\\s*(\\d+)px`).exec(root);
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(floor);
  });
});
