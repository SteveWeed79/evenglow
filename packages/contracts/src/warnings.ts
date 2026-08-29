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
  /** Rain landing on a clip that is owed. A wet fleece cannot be shorn. */
  'shearing-wet',
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
  /** The first day it bites — local midnight, matching a forecast day. */
  at: number;
}

/**
 * One rule's finding for one day, before the days are folded together.
 *
 * Never leaves this module. The sentence is a function of the time phrase
 * rather than a finished string, because the phrase is only known after the
 * fold: the same heat is *"today"*, *"tomorrow"* or *"today and tomorrow"*
 * depending on what the other day turned out to say.
 *
 * That indirection exists because the first version did not have it, and a
 * farm with two hot days got two four-line warnings saying the same thing in
 * different tenses — which pushed the egg tally below the fold. Exactly the
 * failure `TodayScreen` already records about the due list, made again.
 */
interface Draft {
  kind: WarningKind;
  severity: WarningSeverity;
  detail: string;
  at: number;
  /** Whether this is about the night or about the working day. */
  span: 'night' | 'day';
  /** The sentence, given the time phrase to put in it. */
  say: (when: string) => string;
  /**
   * What this is about, when a kind can fire more than once for one day.
   *
   * Only `birth-cold` needs it — two does due the same week are two rows on
   * the same freezing night, and a key of kind-plus-day would give them the
   * same React key and draw one of them twice.
   */
  subject?: string;
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
  /**
   * Clips owed, taken straight off the due engine's `shearing` rows.
   *
   * Same shape and same reasoning as `births`: the due's own key and title,
   * because "Shearing — The Ewes" is already the sentence and a caller
   * reconstructing a name out of it would break the first time the builder
   * changed a word.
   */
  shearings?: readonly { key: string; title: string; at: number }[];
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

/**
 * How long past her date a doe is still expected.
 *
 * **The window used to have no back half, and the case it missed is the ordinary
 * one.** `birthDue` emits a row only while `bornAt` is unrecorded, so an `at` in
 * the past does not mean the birth happened — it means *she has not kidded yet
 * and nobody logged it*. `GESTATION_DAYS` says so itself: every figure there
 * *"varies by several days across breeds and conditions… The date is when to be
 * ready, not a promise."* A doe two days over, on a −7 °C night, got nothing.
 *
 * A week, matching the forward window, because that is the size of the variance
 * those averages carry. It is **not** unbounded, and that is deliberate: a
 * breeding record nobody ever closed would otherwise raise a freezing-night
 * warning every winter for ever, which is the permanent-resident failure
 * `due/types.ts` names — *"a list with a permanent resident on it is a list
 * people stop reading"*. Past a week the likelier readings are that she gave
 * birth unlogged or that something is wrong, and neither is a thing a weather
 * warning can help with.
 */
const BIRTH_OVERDUE_DAYS = 7;

/**
 * How close a clip has to be for rain to be worth saying.
 *
 * **A week, and it was a month.** The original reasoning is kept because it is
 * good and it is only half wrong:
 *
 * > *A month, which is far wider than the birth window and deliberately so. A
 * > shearer is booked rather than summoned, and the useful sentence is "the
 * > weather is against the week you were thinking of" — that is a planning
 * > horizon, not a tonight problem.*
 *
 * That describes a sentence this rule cannot write. What it actually says is
 * `and it is wet ${when}` — one named day — because a `ForecastDay` is all it
 * has. There is no forecast a month out, so a thirty-day window pinned
 * tomorrow's rain to a clip three weeks away and told a farm their shearing was
 * in trouble because of weather that will be long gone. Reported off the
 * tablet: the warning and *"Shearing — Woolies · in 3 weeks"* on one screen.
 *
 * The window cannot usefully outrun the forecast that feeds it. A week is what
 * the forecast covers, so a week is what this can speak about — and inside it
 * the sentence is exactly right: you were going to shear in the next few days,
 * and one of them is wet.
 *
 * The planning horizon the note above wants is a real thing and it is the due
 * row's job: `shearing` has six weeks of notice and says a clip is owed. This
 * says whether the day is any good.
 */
const SHEARING_WINDOW_DAYS = 7;

/**
 * When a day counts as too wet to shear.
 *
 * A wet fleece is not a fleece with a problem, it is a fleece that cannot be
 * baled: packed damp it heats, moulds and rots, and the whole clip is lost
 * rather than downgraded. It is also bad for the animal, which is put back out
 * soaked with no coat, and for the shearer's comb.
 *
 * Sheep also need to be dry to the SKIN, which takes far longer than the
 * ground does — so this is deliberately a low bar. A forty per cent chance is
 * enough to say "not that day", because the cost of the two mistakes is not
 * symmetric: a wrong warning moves a booking, and a missed one ruins a year's
 * wool.
 */
const WET_CHANCE = 40;

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

  const drafts = days.flatMap((day) => [
    ...frostWarnings(day, farm),
    ...freezeWarnings(day, farm),
    ...heatWarnings(day, farm),
    ...birthWarnings(day, farm, today),
    ...shearingWarnings(day, farm, today),
  ]);

  return fold(drafts, today).sort(byUrgency);
}

/**
 * A placeholder no sentence would contain, used to ask two drafts whether they
 * are the same sentence apart from the day.
 */
const WHEN = ' when ';

/**
 * Merges a rule's finding for today with the identical finding for tomorrow.
 *
 * **Only when they are identical.** Two drafts fold when the kind, the
 * severity, the detail line and the whole sentence-apart-from-the-day all
 * match. A watch today and an act tomorrow stay two rows, because
 * *"Dangerous heat today and tomorrow"* would be overstating today — and a
 * warning that overstates is one people learn to discount.
 */
function fold(drafts: readonly Draft[], today: number): Warning[] {
  const groups = new Map<string, Draft[]>();

  for (const draft of drafts) {
    // The subject is in the shape as well as the sentence, so two animals that
    // happen to share a name are never folded into one row.
    const shape = [
      draft.kind,
      draft.subject ?? '',
      draft.severity,
      draft.detail,
      draft.say(WHEN),
    ].join('|');
    const seen = groups.get(shape);
    if (seen === undefined) groups.set(shape, [draft]);
    else seen.push(draft);
  }

  return [...groups.values()].map((group) => {
    const [first] = group;
    // A group is built by pushing, so it always has a member; this is the
    // narrowing rather than an assertion.
    if (first === undefined) throw new Error('A fold group cannot be empty.');

    const at = Math.min(...group.map((draft) => draft.at));
    const bothDays = group.length > 1;
    const isToday = at === today;

    return {
      key: `${first.kind}:${first.subject ?? ''}:${at}${bothDays ? '+' : ''}`,
      kind: first.kind,
      severity: first.severity,
      title: first.say(phrase(first.span, isToday, bothDays)),
      detail: first.detail,
      at,
    };
  });
}

/**
 * How the days are said.
 *
 * Nights and days get different words because the warnings are about different
 * hours: frost and freezing bite overnight, heat bites in the afternoon, and
 * "frost today" is not what anybody would say out loud.
 */
function phrase(span: 'night' | 'day', isToday: boolean, both: boolean): string {
  if (span === 'night') {
    if (both) return 'tonight and tomorrow night';
    return isToday ? 'tonight' : 'tomorrow night';
  }
  if (both) return 'today and tomorrow';
  return isToday ? 'today' : 'tomorrow';
}

/** Act before watch, then soonest, then by key so an order cannot wobble. */
function byUrgency(a: Warning, b: Warning): number {
  if (a.severity !== b.severity) return a.severity === 'act' ? -1 : 1;
  if (a.at !== b.at) return a.at - b.at;
  return a.key < b.key ? -1 : 1;
}

function frostWarnings(day: ForecastDay, farm: FarmToday): Draft[] {
  // A day whose overnight half is not forecast raises nothing. Silence is the
  // right failure for a warning — inventing a low would be a confident number
  // nobody published, which is the same rule `humidity` follows below.
  const low = day.lowDeciC;
  if (low === undefined || low > FROST_DECI_C || farm.uncoveredPlantings === 0) return [];

  const count = farm.uncoveredPlantings;

  return [
    {
      kind: 'frost',
      // Below freezing is not a "watch". Above it, on a clear night, is.
      severity: low <= FREEZE_DECI_C ? 'act' : 'watch',
      detail:
        'Which of them minds is your call — the app knows what is out, not what it can take.',
      at: day.day,
      span: 'night',
      say: (when) =>
        `Frost ${when}. You have ${count} planting${count === 1 ? '' : 's'} in uncovered beds.`,
    },
  ];
}

function freezeWarnings(day: ForecastDay, farm: FarmToday): Draft[] {
  const head = farm.groups.reduce((sum, group) => sum + group.count, 0);
  const low = day.lowDeciC;
  if (low === undefined || low > FREEZE_DECI_C || head === 0) return [];

  return [
    {
      kind: 'freeze',
      severity: 'act',
      detail: `${head} head with nothing to drink by morning, unless the drinkers are seen to.`,
      at: day.day,
      span: 'night',
      say: (when) => `Below freezing ${when}. Waterers will ice over.`,
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
function heatWarnings(day: ForecastDay, farm: FarmToday): Draft[] {
  const out: Draft[] = [];

  const birds = farm.groups.filter((group) => {
    const kind = SPECIES_TRAITS[group.species].group;
    return kind === 'poultry' || kind === 'ratite';
  });

  /**
   * No daytime half, no heat warning.
   *
   * This is the one the fabricated high actually reached: with `highDeciC`
   * filled in from the overnight low, a warm night on a day whose daytime
   * period had passed could raise a heat watch off a number that was never
   * forecast as a high. The hot part of such a day is over by definition.
   */
  const high = day.highDeciC;
  if (high === undefined) return out;

  if (birds.length > 0 && high >= POULTRY_WATCH_DECI_C) {
    const act = high >= POULTRY_ACT_DECI_C;
    out.push({
      kind: 'heat-poultry',
      severity: act ? 'act' : 'watch',
      detail: act
        ? 'Birds cannot sweat. Shade, cool water, and no handling until evening.'
        : 'Extra water in the shade, and do any handling before it warms up.',
      at: day.day,
      span: 'day',
      say: (when) => `${act ? 'Dangerous heat' : 'Heat'} ${when} for ${say(birds)}.`,
    });
  }

  const camelids = farm.groups.filter(
    (group) => group.species === 'alpaca' || group.species === 'llama',
  );

  // Both heat rules need humidity, and neither invents one. See `humidity`.
  if (day.humidity !== undefined) {
    if (camelids.length > 0) {
      const index = camelidHeatIndex(high, day.humidity);
      if (index >= CAMELID_WATCH) {
        const act = index >= CAMELID_ACT;
        out.push({
          kind: 'heat-camelid',
          severity: act ? 'act' : 'watch',
          detail: act
            ? 'Wet the belly and legs, fans, shade. A fleece does not come off in time.'
            : 'Shade and moving air. Check them through the afternoon.',
          at: day.day,
          span: 'day',
          say: (when) => `${act ? 'Heat emergency' : 'Heat'} ${when} for ${say(camelids)}.`,
        });
      }
    }

    const index = thi(high, day.humidity);
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
      const named = say(stressed.map((one) => one.group));

      out.push({
        kind: 'heat-ruminant',
        severity: act ? 'act' : 'watch',
        /**
         * The index is deliberately NOT in the detail line.
         *
         * It changes by a point between today and tomorrow, which would make
         * two otherwise identical warnings refuse to fold — and a farm would
         * get the same sentence twice over a number it cannot act on. What
         * matters is that it is hot and humid, and what to do about it.
         */
        detail: act
          ? 'Shade and water now; expect milk to drop.'
          : 'Watch them through the afternoon.',
        at: day.day,
        span: 'day',
        say: (when) => `Heat and humidity ${when} for ${named}.`,
      });
    }
  }

  return out;
}

function birthWarnings(day: ForecastDay, farm: FarmToday, today: number): Draft[] {
  const low = day.lowDeciC;
  if (low === undefined || low > FREEZE_DECI_C) return [];

  // The window runs from TODAY, not from the forecast day being examined. A
  // birth eight days out is not imminent because tomorrow happens to be cold.
  //
  // Both bounds are measured from today and only the upper one used to exist —
  // see BIRTH_OVERDUE_DAYS for why an overdue birth is the ordinary case rather
  // than a closed one.
  const soon = farm.births.filter(
    (birth) =>
      birth.at >= today - BIRTH_OVERDUE_DAYS * DAY_MS &&
      birth.at <= today + BIRTH_WINDOW_DAYS * DAY_MS,
  );
  if (soon.length === 0) return [];

  return soon.map((birth) => ({
    kind: 'birth-cold' as const,
    severity: 'act' as const,
    detail: 'A newborn is wet and cannot keep itself warm. Somewhere dry, and out of the wind.',
    at: day.day,
    span: 'night' as const,
    subject: birth.key,
    say: (when: string) => `${birth.title}, and it is freezing ${when}.`,
  }));
}

/**
 * Rain landing on a clip that is owed.
 *
 * ## Why this is a warning and not just a due row
 *
 * The `shearing` due already says a fleece is owed. What it cannot say is
 * whether the week somebody was thinking of is any good, and that is the part
 * a farm cannot work out from the app — it means holding the forecast and the
 * due list in your head at once, at 6am, which is exactly the job this screen
 * exists to take off somebody.
 *
 * ## `watch`, never `act`
 *
 * Every other rule here is about an animal in trouble tonight. This one is
 * about a booking, and a booking is not an emergency. Raising it to `act`
 * would put it beside "your alpacas are overheating" and teach a farm that the
 * red rows are sometimes about the diary — which is how the red rows stop
 * being read.
 */
function shearingWarnings(day: ForecastDay, farm: FarmToday, today: number): Draft[] {
  if (day.rainChance < WET_CHANCE) return [];

  // The window runs from TODAY, like `birthWarnings`: a clip owed in March is
  // not made urgent by tomorrow being wet.
  const owed = (farm.shearings ?? []).filter(
    (shearing) => shearing.at >= today - DAY_MS && shearing.at <= today + SHEARING_WINDOW_DAYS * DAY_MS,
  );
  if (owed.length === 0) return [];

  return owed.map((shearing) => ({
    kind: 'shearing-wet' as const,
    severity: 'watch' as const,
    detail:
      'A fleece has to be dry to the skin. Baled damp it heats and moulds, and the clip is lost rather than downgraded.',
    at: day.day,
    span: 'day' as const,
    subject: shearing.key,
    say: (when: string) => `${shearing.title} — and it is wet ${when}.`,
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
