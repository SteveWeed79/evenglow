import { z } from 'zod';
import { type DeciCelsius, fahrenheitToDeciC } from '../units';

/**
 * Hardiness zones — what survives the winter here.
 *
 * **A zone is not a planting date.** It is the average annual minimum winter
 * temperature, and it answers one question: will this plant still be alive in
 * spring. Asparagus, rhubarb, fruit trees, berry canes, perennial herbs — the
 * things that stay in the ground. It says nothing about when anything goes in;
 * that is frost dates, next door in `frost.ts`, and the two are needed
 * together because they answer different questions.
 *
 * ## Why the system is stored alongside the value
 *
 * "7a" means nothing on its own. USDA 7a is −17.8 °C to −15 °C; RHS H4 is a
 * band, not a point; AHS heat zones count days above 30 °C and run the other
 * way entirely. A bare `zone: "7a"` column is a US-only column wearing a
 * general name, and widening it later means migrating every row and guessing
 * what the old ones meant.
 *
 * So a zone is `{ system, value }`, and the comparison below resolves it to a
 * temperature before comparing anything. Adding the UK or Australia is then a
 * table, not a rewrite.
 */

export const ZONE_SYSTEMS = ['usda', 'rhs', 'ahs-heat'] as const;
export const zoneSystemSchema = z.enum(ZONE_SYSTEMS);
export type ZoneSystem = z.infer<typeof zoneSystemSchema>;

export const zoneSchema = z
  .object({
    system: zoneSystemSchema,
    /** '7a', 'H4', '9'. Case and spacing normalised on entry, never on read. */
    value: z.string().min(1).max(8),
  })
  .strict();

export type Zone = z.infer<typeof zoneSchema>;

/**
 * USDA zone floors, in tenths of a degree Celsius.
 *
 * Each zone is a 10 °F band and each half-zone is 5 °F, which is why these are
 * derived from Fahrenheit rather than typed as round Celsius numbers — the
 * boundaries are round in °F and ugly in °C, and rounding them to look tidy
 * would move every boundary by up to a degree.
 */
const USDA_FLOOR_F: Record<string, number> = {
  '1a': -60, '1b': -55, '2a': -50, '2b': -45, '3a': -40, '3b': -35,
  '4a': -30, '4b': -25, '5a': -20, '5b': -15, '6a': -10, '6b': -5,
  '7a': 0, '7b': 5, '8a': 10, '8b': 15, '9a': 20, '9b': 25,
  '10a': 30, '10b': 35, '11a': 40, '11b': 45, '12a': 50, '12b': 55,
  '13a': 60, '13b': 65,
};

/** RHS hardiness ratings, as the minimum temperature each rating survives. */
const RHS_FLOOR_C: Record<string, number> = {
  h1a: 15, h1b: 10, h1c: 5, h2: 1, h3: -5, h4: -10, h5: -15, h6: -20, h7: -25,
};

/** Whitespace and case only. A value the farm typed is not silently rewritten. */
export function normaliseZoneValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * The coldest temperature this zone is expected to see, or null if the system
 * does not express one.
 *
 * AHS heat zones return null on purpose rather than a guess: they count days
 * above 30 °C and carry no cold information at all. A heat zone answers "will
 * this bolt", which is a real question and a different one.
 */
export function zoneFloor(zone: Zone): DeciCelsius | null {
  const value = normaliseZoneValue(zone.value);

  if (zone.system === 'usda') {
    const f = USDA_FLOOR_F[value];
    return f === undefined ? null : fahrenheitToDeciC(f);
  }

  if (zone.system === 'rhs') {
    const c = RHS_FLOOR_C[value];
    return c === undefined ? null : c * 10;
  }

  return null;
}

export const HARDINESS_VERDICTS = ['hardy', 'tender-here', 'unknown'] as const;
export type HardinessVerdict = (typeof HARDINESS_VERDICTS)[number];

/**
 * Whether a plant survives an average winter at this site.
 *
 * **This warns; it never blocks.** A south wall, a cold frame, a tunnel or a
 * pot wheeled into a shed all beat the map, and a grower who knows that must
 * not be told no by an app that does not. `tender-here` is a sentence on a
 * screen, not a refusal — see the callers, none of which filter on it.
 *
 * `unknown` is returned rather than assumed hardy whenever either side is
 * missing or the systems cannot be compared. Silence is the honest answer when
 * the app does not know, and a false "hardy" is the expensive direction to be
 * wrong in.
 */
export function hardinessVerdict(site: Zone | null, plantFloor: DeciCelsius | null): HardinessVerdict {
  if (site === null || plantFloor === null) return 'unknown';

  const floor = zoneFloor(site);
  if (floor === null) return 'unknown';

  // The site's winter low must not go below what the plant tolerates.
  return floor >= plantFloor ? 'hardy' : 'tender-here';
}

/**
 * The sentence shown beside a tender variety.
 *
 * Names the problem and the usual answer in the same breath. A warning that
 * only says "no" gets ignored; one that says "and here is what people do"
 * gets read.
 */
export function hardinessNote(verdict: HardinessVerdict, name: string): string | null {
  switch (verdict) {
    case 'hardy':
      return null;
    case 'tender-here':
      return `${name} usually will not survive winter in your zone. Grown here it wants a pot brought in, a tunnel, or treating as an annual.`;
    case 'unknown':
      return null;
  }
}
