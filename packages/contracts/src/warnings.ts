import { SPECIES_TRAITS, type Species } from './entities/livestock';
import { deciCToFahrenheit } from './units';
import { type Forecast, type ForecastDay, dayStart } from './weather';

/**
 * What the forecast means for THIS farm.
 *
 * ## Why this exists at all
 *
 * A seven-day forecast is a thing every phone already has, better. Steading's
 * only claim is that it knows what the weather means for the animals and beds
 * this farm actually has — and that is a warning, not a table. The screen is
 * the reference; this is the reason weather is in the app.
 *
 * ## Not dues, and the difference is not cosmetic
 *
 * The due engine's second property is that it recomputes locally with the radio
 * off: a device knows the last hour reading and the interval and can do the
 * arithmetic in a barn. A warning cannot. It depends on a cache fetched from a
 * service, and that cache goes stale.
 *
 * Making these `Due` rows would push that difference into every consumer of the
 * due engine — each would have to know that one kind of row is only as good as
 * the last time there was a signal. Keeping them separate means staleness is
 * handled in exactly one place, which is `warningsFor` refusing to say anything
 * at all.
 *
 * ## Silence is the default and it is deliberate
 *
 * There is nothing here on an ordinary day. A strip that appears every morning
 * is a strip nobody reads by the second week, and then it is not there on the
 * morning it matters. Every threshold below is the point where somebody would
 * actually do something differently.
 *
 * ## Two days, not seven
 *
 * A frost forecast six days out is not reliable and not actionable — nothing
 * about tonight changes because next Tuesday looks cold. Today and tomorrow is
 * the window where a warning buys an action: cover the beds, move the drinker
 * indoors, put a lamp in the kidding pen.
 */

export const WARNING_KINDS = [
  /** Frost on plantings that are not under cover. */
  'frost',
  /** Water freezing where there is stock to drink it. */
  'freeze',
  /** Poultry, which have no sweat glands and cook standing up. */
  'heat-poultry',
  /** Ruminants, by temperature-humidity index. */
  'heat-ruminant',
  /** Camelids, which are wearing a fleece and are worse at this than sheep. */
  'heat-camelid',
  /** A cold night landing on a birth that is nearly due. */
  'birth-cold',
] as const;

export type WarningKind = (typeof WARNING_KINDS)[number];

/**
 * How hard it is pushing.
 *
 * Two steps, not four. A due row has four because they carry different
 * instructions across weeks; a warning is about tonight, so the only question
 * is whether somebody has to get up and do something.
 */
export const WARNING_SEVERITIES = ['watch', 'act'] as const;
export type WarningSeverity = (typeof WARNING_SEVERITIES)[number];

export interface Warning {
  /** Stable across recomputations, so a re-render keeps its order and keys. */
  key: string;
  kind: WarningKind;
  severity: WarningSeverity;
  /** One line, already in the farm's words. */
  title: string;
  /** What it means, or what to do. One more line at most. */
  detail: string;
  /** The day it bites — local midnight, matching a forecast day. */
  at: number;
}

/**
 * What the farm has, reduced to the parts a threshold cares about.
 *
 * Deliberately not the records themselves. This module is in `contracts` and
 * has no store; the caller reads what it already reads for Today and hands the
 * counts over. That also makes every rule below testable without a database.
 */
export interface FarmToday {
  groups: readonly WarnableGroup[];
  /**
   * Plantings in the ground, in beds with no cover over them.
   *
   * A count, not a list, because the row a farm asked for is *"you have 6
   * plantings in uncovered beds"* — it defers the judgement to the person who
   * can make it. A keeper knows their own beds; what they cannot do is watch
   * the forecast at 9pm every night in May.
   */
  uncoveredPlantings: number;
  /**
   * Births expected, taken straight off the due engine's `birth` rows.
   *
   * The due's own `key` and `title` rather than a name pulled out of the
   * title — "Nutmeg due" is already the sentence, and a caller doing
   * `title.replace(/ due$/, '')` would break silently the first time the
   * builder changed a word.
   */
  births: readonly { key: string; title: string; at: number }[];
}

export interface WarnableGroup {
  id: string;
  name: string;
  species: Species;
  count: number;
}

// ── the thresholds, each with the reason it is that number ───────────────────

/**
 * Frost forms above freezing.
 *
 * The US National Weather Service issues a Frost Advisory at air temperatures
 * of 33–36°F, because on a still clear night the ground radiates heat and
 * surfaces reach freezing while the thermometer at head height does not. A
 * threshold of exactly zero would miss the nights that actually kill tomatoes.
 */
const FROST_DECI_C = 20;

/** Water freezes at zero. There is no judgement in this one. */
const FREEZE_DECI_C = 0;

/**
 * Poultry have no sweat glands. They lose heat by panting and through the
 * comb, and both stop working as the air approaches body temperature.
 *
 * 29°C is where laying birds start panting and intake drops; 35°C is where
 * heavy breeds begin to die. Two numbers because the actions differ — shade
 * and extra water, versus standing over them.
 */
const POULTRY_WATCH_DECI_C = 290;
const POULTRY_ACT_DECI_C = 350;

/**
 * The temperature-humidity index (NRC 1971), which is the standard measure of
 * heat load on a ruminant:
 *
 *     THI = (1.8T + 32) − (0.55 − 0.0055 × RH)(1.8T − 26)
 *
 * with T in °C and RH as a percentage. It exists because temperature alone
 * lies: 32°C at 30% humidity is a warm day and 32°C at 80% is dangerous, and
 * an animal that cannot dump heat by evaporation does not care which one the
 * thermometer says.
 */
export function thi(deciC: number, humidity: number): number {
  const t = deciC / 10;
  return (1.8 * t + 32) - (0.55 - 0.0055 * humidity) * (1.8 * t - 26);
}

/**
 * Where each ruminant starts to feel it, and where it is serious.
 *
 * Cattle are the sensitive ones — dairy science puts the onset of mild stress
 * at THI 72 and real production loss at 79. Sheep and goats carry more heat
 * before it costs them, so their onset is higher. These are per-species rather
 * than one number for the group because a farm keeping both would otherwise be
 * warned about its goats every time its cows were uncomfortable.
 */
const THI_THRESHOLDS: Partial<Record<Species, { watch: number; act: number }>> = {
  cattle: { watch: 72, act: 79 },
  goat: { watch: 79, act: 84 },
  sheep: { watch: 79, act: 84 },
};

/**
 * Camelids get their own rule, and it is the one their keepers use.
 *
 * Alpacas and llamas are wearing a fleece and are worse at shedding heat than
 * anything else on a smallholding. The field measure is the heat index —
 * **temperature in °F plus relative humidity** — where 120 is the point to
 * start watching and 150 is an emergency. Running them through THI would put
 * them alongside sheep, which is exactly the mistake that kills alpacas.
 */
const CAMELID_WATCH = 120;
const CAMELID_ACT = 150;

/** Degrees Fahrenheit plus relative humidity — the camelid rule, as stated. */
export function camelidHeatIndex(deciC: number, humidity: number): number {
  return deciCToFahrenheit(deciC) + humidity;
}

/**
 * How close a birth has to be for a cold night to matter.
 *
 * A newborn is wet and cannot regulate its own temperature for the first hours.
 * A week is roughly the window in which "be around, and put a lamp in" is a
 * thing somebody can arrange, and the `birth` due already carries six weeks of
 * notice for the pen-building half.
 */
const BIRTH_WINDOW_DAYS = 7;

const DAY_MS = 86_400_000;

// ── the rules ────────────────────────────────────────────────────────────────

/**
 * Every warning this farm has, for today and tomorrow.
 *
 * Returns nothing at all when there is no forecast, or when the one there is
 * has gone stale. **A stale forecast raises no warning**, and that is the
 * correct failure for a feature whose whole promise is that it works offline:
 * the first version of a network-dependent alert on this screen should err
 * towards silence rather than towards a confident sentence about a night that
 * has already happened.
 */
export function warningsFor(
  weather: { forecast: Forecast; stale: boolean } | null,
  farm: FarmToday,
  now: number,
): Warning[] {
  if (weather === null || weather.stale) return [];

  const today = dayStart(now);
  const days = weather.forecast.days.filter(
    (day) => day.day >= today && day.day <= today + DAY_MS,
  );

  return days
    .flatMap((day) => [
      ...frostWarnings(day, farm, today),
      ...freezeWarnings(day, farm, today),
      ...heatWarnings(day, farm, today),
      ...birthWarnings(day, farm, today),
    ])
    .sort(byUrgency);
}

/** Act before watch, then soonest, then by key so an order cannot wobble. */
function byUrgency(a: Warning, b: Warning): number {
  if (a.severity !== b.severity) return a.severity === 'act' ? -1 : 1;
  if (a.at !== b.at) return a.at - b.at;
  return a.key < b.key ? -1 : 1;
}

/** "tonight" or "tomorrow night" — a warning about a day nobody has yet. */
function nightOf(day: ForecastDay, today: number): string {
  return day.day === today ? 'tonight' : 'tomorrow night';
}

function dayNameOf(day: ForecastDay, today: number): string {
  return day.day === today ? 'today' : 'tomorrow';
}

function frostWarnings(day: ForecastDay, farm: FarmToday, today: number): Warning[] {
  if (day.lowDeciC > FROST_DECI_C || farm.uncoveredPlantings === 0) return [];

  const count = farm.uncoveredPlantings;

  return [
    {
      key: `frost:${day.day}`,
      kind: 'frost',
      // Below freezing is not a "watch". Above it, on a clear night, is.
      severity: day.lowDeciC <= FREEZE_DECI_C ? 'act' : 'watch',
      title: `Frost ${nightOf(day, today)}. You have ${count} planting${
        count === 1 ? '' : 's'
      } in uncovered beds.`,
      detail:
        'Which of them minds is your call — the app knows what is out, not what it can take.',
      at: day.day,
    },
  ];
}

function freezeWarnings(day: ForecastDay, farm: FarmToday, today: number): Warning[] {
  const head = farm.groups.reduce((sum, group) => sum + group.count, 0);
  if (day.lowDeciC > FREEZE_DECI_C || head === 0) return [];

  return [
    {
      key: `freeze:${day.day}`,
      kind: 'freeze',
      severity: 'act',
      title: `Below freezing ${nightOf(day, today)}. Waterers will ice over.`,
      detail: `${head} head with nothing to drink by morning, unless the drinkers are seen to.`,
      at: day.day,
    },
  ];
}

/**
 * Heat, by three different rules, because the animals differ more than the
 * weather does.
 *
 * A single "hot day" warning would be wrong for every one of them: poultry
 * suffer on dry heat that a cow shrugs off, a cow suffers at a temperature
 * that is nothing to a goat, and an alpaca is in trouble before any of them.
 */
function heatWarnings(day: ForecastDay, farm: FarmToday, today: number): Warning[] {
  const out: Warning[] = [];
  const when = dayNameOf(day, today);

  const birds = farm.groups.filter((group) => {
    const kind = SPECIES_TRAITS[group.species].group;
    return kind === 'poultry' || kind === 'ratite';
  });

  if (birds.length > 0 && day.highDeciC >= POULTRY_WATCH_DECI_C) {
    const act = day.highDeciC >= POULTRY_ACT_DECI_C;
    out.push({
      key: `heat-poultry:${day.day}`,
      kind: 'heat-poultry',
      severity: act ? 'act' : 'watch',
      title: act
        ? `Dangerous heat ${when} for ${say(birds)}.`
        : `Heat ${when} for ${say(birds)}.`,
      detail: act
        ? 'Birds cannot sweat. Shade, cool water, and no handling until evening.'
        : 'Extra water in the shade, and do any handling before it warms up.',
      at: day.day,
    });
  }

  const camelids = farm.groups.filter(
    (group) => group.species === 'alpaca' || group.species === 'llama',
  );

  // Both heat rules need humidity, and neither invents one. See `humidity`.
  if (day.humidity !== undefined) {
    if (camelids.length > 0) {
      const index = camelidHeatIndex(day.highDeciC, day.humidity);
      if (index >= CAMELID_WATCH) {
        const act = index >= CAMELID_ACT;
        out.push({
          key: `heat-camelid:${day.day}`,
          kind: 'heat-camelid',
          severity: act ? 'act' : 'watch',
          title: act
            ? `Heat emergency ${when} for ${say(camelids)}.`
            : `Heat ${when} for ${say(camelids)}.`,
          detail: act
            ? 'Wet the belly and legs, fans, shade. A fleece does not come off in time.'
            : 'Shade and moving air. Check them through the afternoon.',
          at: day.day,
        });
      }
    }

    const index = thi(day.highDeciC, day.humidity);
    // Paired with its threshold rather than looked up twice: the second lookup
    // is what would need a `!`, and a non-null assertion is a promise the type
    // system stops checking.
    const stressed = farm.groups.flatMap((group) => {
      const threshold = THI_THRESHOLDS[group.species];
      if (threshold === undefined || index < threshold.watch) return [];
      return [{ group, threshold }];
    });

    if (stressed.length > 0) {
      const act = stressed.some(({ threshold }) => index >= threshold.act);
      out.push({
        key: `heat-ruminant:${day.day}`,
        kind: 'heat-ruminant',
        severity: act ? 'act' : 'watch',
        title: `Heat and humidity ${when} for ${say(stressed.map((one) => one.group))}.`,
        detail: `Heat index ${Math.round(index)}. ${
          act ? 'Shade and water now; expect milk to drop.' : 'Watch them through the afternoon.'
        }`,
        at: day.day,
      });
    }
  }

  return out;
}

function birthWarnings(day: ForecastDay, farm: FarmToday, today: number): Warning[] {
  if (day.lowDeciC > FREEZE_DECI_C) return [];

  const soon = farm.births.filter(
    (birth) => birth.at >= today && birth.at <= today + BIRTH_WINDOW_DAYS * DAY_MS,
  );
  if (soon.length === 0) return [];

  return soon.map((birth) => ({
    key: `birth-cold:${birth.key}:${day.day}`,
    kind: 'birth-cold' as const,
    severity: 'act' as const,
    title: `${birth.title}, and it is freezing ${nightOf(day, today)}.`,
    detail: 'A newborn is wet and cannot keep itself warm. Somewhere dry, and out of the wind.',
    at: day.day,
  }));
}

/**
 * Names the groups, or counts them past two.
 *
 * "The hens and the ducks" is a sentence. "The hens, the ducks, the geese, the
 * turkeys and the quail" is a list nobody finishes at arm's length in a barn.
 */
function say(groups: readonly WarnableGroup[]): string {
  const [first, second] = groups.map((group) => group.name);
  if (first === undefined) return 'your stock';
  if (second === undefined) return first;
  if (groups.length === 2) return `${first} and ${second}`;
  return `${groups.length} groups`;
}
