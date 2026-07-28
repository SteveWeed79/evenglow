import { describe, expect, it } from 'vitest';
import { basketConfirmation, loggedConfirmation, spellCount } from '@steading/core/voice';

/**
 * UX-SPEC §6 — the whimsy budget.
 *
 * These read like copy tests because they are. The rule the spec is strictest
 * about is not which words are warm, it is *where* warmth is allowed, and the
 * only way that survives contact with a second developer is if the boundary
 * is asserted somewhere.
 */

describe('spellCount', () => {
  it('spells the counts a person actually says', () => {
    expect(spellCount(0)).toBe('zero');
    expect(spellCount(1)).toBe('one');
    expect(spellCount(12)).toBe('twelve');
    // The spec's own example sentence.
    expect(spellCount(18)).toBe('eighteen');
  });

  it('hyphenates the compound tens', () => {
    expect(spellCount(20)).toBe('twenty');
    expect(spellCount(24)).toBe('twenty-four');
    expect(spellCount(99)).toBe('ninety-nine');
  });

  it('gives up above ninety-nine rather than getting florid', () => {
    // "two hundred and forty" is not warmer than "240", only longer.
    expect(spellCount(100)).toBe('100');
    expect(spellCount(240)).toBe('240');
  });

  it('returns digits for anything that is not a plain count', () => {
    expect(spellCount(-1)).toBe('-1');
    expect(spellCount(1.5)).toBe('1.5');
    expect(spellCount(Number.NaN)).toBe('NaN');
  });
});

describe('confirmations', () => {
  it('exhales in one short sentence', () => {
    expect(basketConfirmation(18)).toBe('Eighteen in the basket.');
  });

  /**
   * The reason the basket line is opt-in rather than the Tally's default.
   *
   * The Tally is reused for every countable log, so a confirmation baked into
   * it would follow hour meters and feed weights around. "412 hours in the
   * basket" is precisely the failure §6 is written to prevent — warmth
   * applied without looking at what it is describing.
   */
  it('falls back to something true of any countable thing', () => {
    expect(loggedConfirmation(412, 'hours')).toBe('412 hours logged.');
    expect(loggedConfirmation(3, 'bales')).toBe('Three bales logged.');
  });

  it('keeps sentence case, never shouting', () => {
    for (const sentence of [basketConfirmation(6), loggedConfirmation(6, 'eggs')]) {
      expect(sentence).not.toBe(sentence.toUpperCase());
      expect(sentence.endsWith('.')).toBe(true);
      expect(sentence).not.toContain('!');
    }
  });
});
