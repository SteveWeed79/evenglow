import { animalCreateSchema, type Species } from '@homefarm/contracts';
import { localStore } from '../db/store';

/**
 * Individual animals inside a group.
 *
 * The parity floor (P1/P2) asks for these, and one feature makes them
 * unavoidable rather than nice to have: a `breeding` record names a `damId`,
 * and a dam is an individual. Without named animals a farm can record that
 * something is pregnant but not what — so goats and sheep, the species this
 * matters most for, would have had a birthing feature with nothing to hang it
 * on.
 *
 * Not every animal needs a record. A pen of forty broilers is a group and
 * stays one; a doe with a name and four kiddings behind her is an individual.
 * The app takes no view on which, because the keeper already has one.
 */

export interface Animal {
  id: string;
  flockId: string;
  name: string;
  species: Species;
  breed?: string;
  sex?: 'female' | 'male' | 'unknown';
  bornAt?: number;
  tag?: string;
  weightGrams?: number;
  note?: string;
}

const storedAnimal = animalCreateSchema.partial();

export async function listAnimals(): Promise<Animal[]> {
  const records = await localStore().readRecordsByEntity('animal');

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = storedAnimal.safeParse(record.value);
      if (
        !parsed.success ||
        parsed.data.name === undefined ||
        parsed.data.species === undefined ||
        parsed.data.flockId === undefined
      ) {
        return [];
      }

      const { name, species, flockId, breed, sex, bornAt, tag, weightGrams, note } = parsed.data;
      return [
        {
          id: record.targetId,
          flockId,
          name,
          species,
          ...(breed === undefined ? {} : { breed }),
          ...(sex === undefined ? {} : { sex }),
          ...(bornAt === undefined ? {} : { bornAt }),
          ...(tag === undefined ? {} : { tag }),
          ...(weightGrams === undefined ? {} : { weightGrams }),
          ...(note === undefined ? {} : { note }),
        } satisfies Animal,
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The animals in one group. */
export function inGroup(animals: readonly Animal[], flockId: string): Animal[] {
  return animals.filter((a) => a.flockId === flockId);
}

/**
 * The ones that can carry a pregnancy.
 *
 * Unknown sex is included deliberately. A keeper who has not filled the field
 * in still knows which of their goats is in kid, and hiding the animal would
 * make the field a prerequisite for recording a mating rather than a detail.
 */
export function possibleDams(animals: readonly Animal[]): Animal[] {
  return animals.filter((a) => a.sex !== 'male');
}
