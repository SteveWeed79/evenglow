import { describe, expect, it } from 'vitest';
import {
  basketConfirmation,
  groupPhrase,
  loggedConfirmation,
  SAID,
  saidConfirmation,
  spellCount,
} from '@steading/core/voice';

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

describe('groupPhrase', () => {
  it('says the species own word, as a sentence', () => {
    // The bug this replaced rendered `CHICKENS · FLOCK · 10 HEAD · AUSTRALORP`
    // in tracked caps — a farm's own word for its own animals, set in the
    // register this app reserves for units and section labels.
    expect(
      groupPhrase({
        collective: 'flock',
        species: 'chickens',
        singular: 'chicken',
        count: 10,
        breed: 'Australorp',
      }),
    ).toBe('A flock of 10 Australorp chickens.');
  });

  it('uses each species own collective rather than "flock" for everything', () => {
    expect(groupPhrase({ collective: 'herd', species: 'goats', count: 8 })).toBe(
      'A herd of 8 goats.',
    );
    expect(groupPhrase({ collective: 'drove', species: 'pigs', count: 3 })).toBe(
      'A drove of 3 pigs.',
    );
    expect(groupPhrase({ collective: 'gaggle', species: 'geese', count: 6 })).toBe(
      'A gaggle of 6 geese.',
    );
  });

  it('keeps the count as a numeral', () => {
    // `spellCount` is for prose read as English. A head count is data, read at
    // a glance off a screen held at arm's length.
    expect(groupPhrase({ collective: 'flock', species: 'sheep', count: 18 })).toBe(
      'A flock of 18 sheep.',
    );
  });

  it('drops the noun rather than saying "other"', () => {
    // The `other` species has no word worth saying; the sentence stops at the
    // count instead of naming a category nobody chose.
    expect(groupPhrase({ collective: 'group', count: 2 })).toBe('A group of 2.');
  });

  it('omits the numeral where the count has its own column', () => {
    // Stock's cards show the head count at display size beside the name, so
    // the sentence must not repeat it — but still has to know it.
    expect(
      groupPhrase({ collective: 'herd', species: 'cattle', count: 12, showCount: false }),
    ).toBe('A herd of cattle.');
  });

  /**
   * The case a handset found: "First Try — A herd of Angus cattle." beside a
   * head count of 1.
   *
   * There is no collective noun for one of anything, so the collective goes
   * and the singular does the work. Reaching for the plural species word here
   * is what made the sentence wrong.
   */
  describe('a group of one', () => {
    it('is not a herd', () => {
      expect(
        groupPhrase({
          collective: 'herd',
          species: 'cattle',
          singular: 'cow',
          count: 1,
          breed: 'Angus',
          showCount: false,
        }),
      ).toBe('One Angus cow.');
    });

    it('reads the same whether or not the count is printed elsewhere', () => {
      // "One" is already the count, so `showCount` has nothing to suppress.
      const shown = groupPhrase({ collective: 'flock', species: 'geese', singular: 'goose', count: 1 });
      const hidden = groupPhrase({
        collective: 'flock',
        species: 'geese',
        singular: 'goose',
        count: 1,
        showCount: false,
      });

      expect(shown).toBe('One goose.');
      expect(hidden).toBe(shown);
    });

    it('uses the word for one rather than de-pluralising the label', () => {
      // English gives no rule that turns "Cattle" into "cow" or "Geese" into
      // "goose", which is why the singular is written down per species.
      expect(groupPhrase({ collective: 'flock', species: 'sheep', singular: 'sheep', count: 1 })).toBe(
        'One sheep.',
      );
      expect(
        groupPhrase({ collective: 'flock', species: 'guinea fowl', singular: 'guinea fowl', count: 1 }),
      ).toBe('One guinea fowl.');
    });

    it('falls back rather than saying nothing when the species has no word', () => {
      expect(groupPhrase({ collective: 'group', count: 1 })).toBe('One of them.');
    });
  });

  /**
   * `count` is `nonnegative` in the schema, so a group emptied by a sale, a
   * processing day or a bad night is a real row — and it is still a group.
   */
  describe('a group of none', () => {
    it('is not a herd of zero', () => {
      expect(groupPhrase({ collective: 'herd', species: 'goats', singular: 'goat', count: 0 })).toBe(
        'No goats yet.',
      );
    });

    it('says something rather than nothing when the species has no word', () => {
      expect(groupPhrase({ collective: 'group', count: 0 })).toBe('Nothing in it yet.');
    });
  });
});

describe('the said confirmations', () => {
  it('is one short plain sentence per entity', () => {
    for (const [kind, sentence] of Object.entries(SAID)) {
      // "Confirmations may exhale... one short, plain sentence" — UX-SPEC §6.
      expect(sentence, kind).toMatch(/^[A-Z][^.!?]*\.$/);
      expect(sentence.length, kind).toBeLessThanOrEqual(24);
    }
  });

  it('never uses an exclamation mark', () => {
    // Explicitly banned in system copy (UX-SPEC §6).
    for (const sentence of Object.values(SAID)) expect(sentence).not.toContain('!');
  });

  it('is reached through a checked key', () => {
    expect(saidConfirmation('note')).toBe('Noted.');
    expect(saidConfirmation('candling')).toBe('Candled.');
  });
});
