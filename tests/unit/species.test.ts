import { describe, expect, it } from 'vitest';
import {
  collectiveNoun,
  flockCreateSchema,
  laysEggs,
  SPECIES,
  SPECIES_TRAITS,
  type Species,
} from '@steading/contracts';

/**
 * Smallholdings are mixed. These assertions exist so the model cannot quietly
 * drift back to being a chicken app.
 */

describe('species taxonomy', () => {
  it('covers more than poultry', () => {
    for (const species of ['goat', 'cattle', 'sheep', 'pig', 'emu', 'rabbit'] as const) {
      expect(SPECIES).toContain(species);
    }
  });

  it('describes every species it accepts', () => {
    for (const species of SPECIES) {
      const traits = SPECIES_TRAITS[species];
      expect(traits.label.length).toBeGreaterThan(0);
      expect(traits.collective.length).toBeGreaterThan(0);
    }
  });

  it('has no traits entry for a species that is not offered', () => {
    expect(Object.keys(SPECIES_TRAITS).sort()).toEqual([...SPECIES].sort());
  });

  it('keeps an escape hatch, because the list will never be complete', () => {
    expect(SPECIES).toContain('other');
    expect(flockCreateSchema.safeParse({
      name: 'The yaks',
      species: 'other',
      speciesOther: 'yak',
      count: 3,
    }).success).toBe(true);
  });
});

describe('collective nouns', () => {
  it('does not call a cattle herd a flock', () => {
    // A keeper reading the wrong word learns the app was not built for them.
    expect(collectiveNoun('cattle')).toBe('herd');
    expect(collectiveNoun('goat')).toBe('herd');
    expect(collectiveNoun('pig')).toBe('drove');
    expect(collectiveNoun('goose')).toBe('gaggle');
  });

  it('still calls a flock of hens a flock', () => {
    expect(collectiveNoun('chicken')).toBe('flock');
    expect(collectiveNoun('sheep')).toBe('flock');
  });
});

describe('egg-laying', () => {
  const layers: Species[] = ['chicken', 'duck', 'goose', 'quail', 'emu', 'ostrich'];
  const nonLayers: Species[] = ['goat', 'cattle', 'sheep', 'pig', 'horse', 'alpaca'];

  it.each(layers)('offers egg logging for %s', (species) => {
    expect(laysEggs(species)).toBe(true);
  });

  it.each(nonLayers)('does not offer egg logging for %s', (species) => {
    expect(laysEggs(species)).toBe(false);
  });

  it('gives "other" the benefit of the doubt', () => {
    // An unlisted species is more likely a bird we missed than a mammal, and
    // refusing to record something the user is holding is the worse failure.
    expect(laysEggs('other')).toBe(true);
  });
});

describe('flock schema', () => {
  it('accepts a herd of cattle', () => {
    const result = flockCreateSchema.safeParse({
      name: 'The Dexters',
      species: 'cattle',
      breed: 'Dexter',
      count: 4,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a mob of emu', () => {
    expect(flockCreateSchema.safeParse({ name: 'Emu', species: 'emu', count: 2 }).success).toBe(
      true,
    );
  });

  it('rejects a species that is not in the list', () => {
    expect(flockCreateSchema.safeParse({ name: 'X', species: 'dragon', count: 1 }).success).toBe(
      false,
    );
  });
});
