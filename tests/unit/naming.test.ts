import { describe, expect, it } from 'vitest';
import { defaultGroupName } from '@homefarm/core/naming';

/**
 * Two groups called "Chickens".
 *
 * The name field has always been optional, falling back to the species label,
 * and its placeholder showed that same label — grey text that reads as an
 * answer already given. So nobody typed one, and a keeper who added chickens
 * twice got two identical rows on Today with no way to tell which was which.
 *
 * Requiring a name would be the wrong fix: onboarding is meant to need "no
 * typing beyond a farm name" (UX-SPEC §5). Making the default distinct, and
 * showing it, is the right one.
 */

describe('defaultGroupName', () => {
  it('uses the plain label when nothing has claimed it', () => {
    expect(defaultGroupName('Chickens', [])).toBe('Chickens');
    expect(defaultGroupName('Chickens', ['Goats', 'Ducks'])).toBe('Chickens');
  });

  it('numbers from two, because the first one is not "Chickens 1"', () => {
    expect(defaultGroupName('Chickens', ['Chickens'])).toBe('Chickens 2');
    expect(defaultGroupName('Chickens', ['Chickens', 'Chickens 2'])).toBe('Chickens 3');
  });

  it('fills a gap rather than always taking the next number', () => {
    expect(defaultGroupName('Chickens', ['Chickens', 'Chickens 3'])).toBe('Chickens 2');
  });

  /** "chickens" and "Chickens" are the same flock to everyone but a comparison. */
  it('ignores case and surrounding space', () => {
    expect(defaultGroupName('Chickens', ['  chickens '])).toBe('Chickens 2');
    expect(defaultGroupName('Chickens', ['CHICKENS', 'chickens 2'])).toBe('Chickens 3');
  });

  it('does not collide with a name someone typed themselves', () => {
    expect(defaultGroupName('Chickens', ['Chickens', 'The layers'])).toBe('Chickens 2');
  });

  it('terminates on a farm with a lot of chickens', () => {
    const many = ['Chickens', ...Array.from({ length: 30 }, (_, i) => `Chickens ${i + 2}`)];
    expect(defaultGroupName('Chickens', many)).toBe('Chickens 32');
  });
});
