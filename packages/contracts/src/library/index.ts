import { fahrenheitToDeciC, inchesToUm } from '../units';
import { LIBRARY_BREEDS } from './breeds';
import type { LibraryBreed, LibraryVariety, Purpose, Range } from './types';
import { LIBRARY_VARIETIES } from './varieties';
import type { VarietyTiming } from '../growing/schedule';

export * from './types';
export { LIBRARY_BREEDS } from './breeds';
export { LIBRARY_VARIETIES } from './varieties';

/**
 * Using the library.
 *
 * The library is **data, not rows**. Picking an entry creates a farm's own
 * `variety` record with the numbers copied in, which is what makes the
 * override rule work: the farm edits its copy, and a later app version can
 * revise the library without silently rewriting anyone's records.
 *
 * It also means the app has no concept of "a library variety you have not
 * added yet" cluttering the store, and no migration to write when the library
 * grows.
 */

const byId = <T extends { id: string }>(items: readonly T[]): ReadonlyMap<string, T> =>
  new Map(items.map((item) => [item.id, item]));

const VARIETIES_BY_ID = byId(LIBRARY_VARIETIES);
const BREEDS_BY_ID = byId(LIBRARY_BREEDS);

export function libraryVariety(id: string): LibraryVariety | undefined {
  return VARIETIES_BY_ID.get(id);
}

export function libraryBreed(id: string): LibraryBreed | undefined {
  return BREEDS_BY_ID.get(id);
}

export function breedsForSpecies(species: string): LibraryBreed[] {
  return LIBRARY_BREEDS.filter((b) => b.species === species);
}

/**
 * Breeds matching a purpose, for the "what should I keep?" question.
 *
 * Purposes are a multi-select on the breed, so a dual-purpose bird appears
 * under both eggs and meat rather than being forced into one.
 */
export function breedsForPurpose(purpose: Purpose): LibraryBreed[] {
  return LIBRARY_BREEDS.filter((b) => b.purposes.includes(purpose));
}

/**
 * Free-text match over name and aliases.
 *
 * Aliases exist because people type what they say: "Cornish X", "broiler",
 * "Barred Rock". A search that only matched the registry name would fail on
 * the words most keepers actually use.
 */
export function searchBreeds(query: string): LibraryBreed[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];

  return LIBRARY_BREEDS.filter(
    (b) =>
      b.name.toLowerCase().includes(q) ||
      b.species.toLowerCase().includes(q) ||
      (b.aliases ?? []).some((a) => a.toLowerCase().includes(q)),
  );
}

export function searchVarieties(query: string): LibraryVariety[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];

  return LIBRARY_VARIETIES.filter(
    (v) => v.name.toLowerCase().includes(q) || v.crop.toLowerCase().includes(q),
  );
}

/** Every distinct crop, sorted. What a "what shall I plant?" list shows first. */
export function libraryCrops(): string[] {
  return [...new Set(LIBRARY_VARIETIES.map((v) => v.crop))].sort((a, b) => a.localeCompare(b));
}

/**
 * A library entry as a `variety:create` payload.
 *
 * This is the only conversion boundary: inches and Fahrenheit go in because
 * that is how the library is authored and checked, micrometres and tenths of
 * a degree come out because that is what is stored. `custom: false` marks it
 * as having come from the library, so a farm can tell its own additions apart
 * from what shipped.
 */
export function varietyPayload(entry: LibraryVariety): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: entry.name,
    crop: entry.crop,
    family: entry.family,
    lifecycle: entry.lifecycle,
    daysToMaturity: entry.daysToMaturity,
    custom: false,
  };

  const put = (key: string, value: number | undefined): void => {
    if (value !== undefined) payload[key] = value;
  };

  put('startIndoorsWeeksBefore', entry.startIndoorsWeeksBefore);
  put('transplantWeeksAfter', entry.transplantWeeksAfter);
  put('directSowWeeksAfter', entry.directSowWeeksAfter);
  put('autumnSowWeeksBefore', entry.autumnSowWeeksBefore);
  put('successionDays', entry.successionDays);

  put('spacingUm', entry.spacingIn === undefined ? undefined : inchesToUm(entry.spacingIn));
  put('rowSpacingUm', entry.rowSpacingIn === undefined ? undefined : inchesToUm(entry.rowSpacingIn));
  put('sowDepthUm', entry.sowDepthIn === undefined ? undefined : inchesToUm(entry.sowDepthIn));
  put('hardyToDeciC', entry.hardyToF === undefined ? undefined : fahrenheitToDeciC(entry.hardyToF));

  if (entry.note !== undefined) payload['note'] = entry.note;

  return payload;
}

/**
 * The timing a library entry implies, for `scheduleFor`.
 *
 * Absent stages become null rather than a plausible default. Garlic has no
 * spring anchor at all, and a made-up indoor start would put a row on
 * someone's Today telling them to do something nobody does.
 */
export function timingOf(entry: LibraryVariety): VarietyTiming {
  return {
    startIndoorsWeeksBefore: entry.startIndoorsWeeksBefore ?? null,
    transplantWeeksAfter: entry.transplantWeeksAfter ?? null,
    directSowWeeksAfter: entry.directSowWeeksAfter ?? null,
    autumnSowWeeksBefore: entry.autumnSowWeeksBefore ?? null,
    daysToMaturity: entry.daysToMaturity,
  };
}

/**
 * A range as one line: "6–9 weeks", or "8 weeks" when the ends agree.
 *
 * The en dash rather than a hyphen, and the unit only once. This is read on a
 * phone at arm's length; "6 weeks - 9 weeks" is the same information taking
 * twice the width.
 */
export function formatRange(range: Range, unit: string): string {
  const [low, high] = range;
  return low === high ? `${low} ${unit}` : `${low}–${high} ${unit}`;
}

/**
 * The midpoint of a range, for arithmetic that needs one number.
 *
 * Used to seed a countdown, never to display. A processing date shown as a
 * single day would throw away exactly the honesty the range was carrying —
 * `formatRange` is what a person sees.
 */
export function midpoint(range: Range): number {
  return (range[0] + range[1]) / 2;
}
