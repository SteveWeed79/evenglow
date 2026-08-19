import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONTS } from '@homefarm/mobile/theme/tokens';

/**
 * Every named face ships, and every shipped face is named.
 *
 * This is the check that did not exist, and its absence cost the app its
 * entire type system without anyone noticing. `tokens.ts` named four families
 * and none of them was ever registered — Android substitutes the system face
 * for an unknown `fontFamily` rather than erroring, so headings, the tally and
 * the small-caps labels all rendered in Roboto while the code said Fraunces.
 *
 * A typecheck cannot catch it: `fontFamily` is a string. The bundler cannot
 * catch it: a string is a string. Only a device could show it, and there was
 * no device. So the file system is asked instead.
 */

const FONT_DIR = 'apps/mobile/assets/fonts';

/** Family name → the file that must provide it. */
const EXPECTED: Record<string, string> = {
  [FONTS.display]: 'Fraunces-Soft30Wonk1-Bold.ttf',
  [FONTS.body]: 'AlegreyaSans-Regular.ttf',
  [FONTS.bodyBold]: 'AlegreyaSans-Bold.ttf',
  [FONTS.data]: 'IBMPlexMono-Regular.ttf',
  [FONTS.dataBold]: 'IBMPlexMono-Bold.ttf',
};

describe('the type ramp has faces behind it', () => {
  it.each(Object.entries(EXPECTED))('%s ships as a file', (_family, file) => {
    expect(existsSync(join(FONT_DIR, file))).toBe(true);
  });

  it('names every token exactly once', () => {
    // A duplicate key here would mean two tokens silently sharing one face.
    expect(Object.keys(EXPECTED)).toHaveLength(new Set(Object.values(FONTS)).size);
  });

  it('registers every shipped face, so nothing is dead weight in the APK', () => {
    const shipped = readdirSync(FONT_DIR).filter((f) => f.endsWith('.ttf'));
    expect(shipped.sort()).toEqual(Object.values(EXPECTED).sort());
  });

  /**
   * The licence has to travel with the fonts.
   *
   * All three families are SIL OFL 1.1, which requires the text to be
   * distributed with them — and an APK is a distribution. Beside the fonts
   * rather than in a docs folder, because that is where someone unpacking one
   * would look.
   */
  it('carries the licence for each family', () => {
    const licences = readdirSync(FONT_DIR).filter((f) => f.startsWith('OFL-'));
    expect(licences.sort()).toEqual([
      'OFL-AlegreyaSans.txt',
      'OFL-Fraunces.txt',
      'OFL-IBMPlexMono.txt',
    ]);

    for (const licence of licences) {
      expect(readFileSync(join(FONT_DIR, licence), 'utf8')).toContain('SIL OPEN FONT LICENSE');
    }
  });

  /**
   * Fraunces is a static cut, not the variable font.
   *
   * React Native cannot set variation axes, so shipping the variable face
   * would render at its defaults — SOFT 0, WONK 1, weight 900 — which is a
   * different typeface from the one the design specified and would look
   * plausible enough to go unquestioned.
   */
  it('ships Fraunces with its axes already resolved', () => {
    const ttf = readFileSync(join(FONT_DIR, EXPECTED[FONTS.display]!));
    const tags = new Set<string>();
    const count = ttf.readUInt16BE(4);
    for (let i = 0; i < count; i += 1) {
      tags.add(ttf.subarray(12 + i * 16, 16 + i * 16).toString('ascii'));
    }

    expect(tags.has('fvar')).toBe(false);
    expect(tags.has('glyf')).toBe(true);
  });
});
